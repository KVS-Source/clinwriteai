// Import a Module B publication template from a repo JSON file (e.g. docs/templates/
// manuscript-original-research.template.json, generated from docs/ClinWrite_Master_Manuscript_Template.docx).
//
// Writes, for the file's docType:
//   - PublicationTemplate           the sections (id, number, title, guidance, starterHtml); new publications of this
//                                   type start with these sections and their starter text (POST /publications)
//   - PublicationChecklistTemplate  the pre-submission checklist items
//   - PublicationTypePolicy         points the docType at both, with the reporting guideline
//
// Safe to re-run: content identical to the current row is left alone; changed content becomes a new version (the
// old one stays, no longer current). Nothing is written when `apply` is false; the plan says what would happen.

import { z } from 'zod'

const sectionSchema = z.object({
  id:          z.string().regex(/^[a-z0-9_]+$/),
  number:      z.string().min(1),
  title:       z.string().min(1),
  guidance:    z.string().optional(),
  internal:    z.boolean().optional(),
  starterHtml: z.string().optional(),
})

export const publicationTemplateFileSchema = z.object({
  schemaVersion: z.literal(1),
  template: z.object({
    docType:      z.string().regex(/^[a-z0-9_]+$/),
    label:        z.string().min(1),
    description:  z.string().default(''),
    guidelineKey: z.string().optional(),
  }),
  sections:  z.array(sectionSchema).min(1).refine(s => new Set(s.map(x => x.id)).size === s.length, 'section ids must be unique'),
  checklist: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), required: z.boolean(), groupId: z.string().min(1) })).default([]),
}).passthrough()

export type PublicationTemplateFile = z.infer<typeof publicationTemplateFileSchema>

type Step = { action: 'create' | 'new_version' | 'unchanged'; version: number; id?: string }
export interface TemplateImportPlan { docType: string; template: Step; checklist: Step | null; policy: Step }

interface Row { id: string; version: number }
interface Db {
  publicationTemplate: {
    findFirst(a: unknown): Promise<(Row & { sections: unknown; label: string; description: string }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
  publicationChecklistTemplate: {
    findFirst(a: unknown): Promise<(Row & { items: unknown }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
  publicationTypePolicy: {
    findFirst(a: unknown): Promise<(Row & { templateId: string | null; checklistTemplateId: string | null; guidelineKey: string | null; smePrompt: string; bestPracticeDigest: unknown; sectionRules: unknown }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
}

// Key order doesn't count: Postgres jsonb stores object keys in its own order, so content read back from the database
// must still match the file it came from.
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]))
  : v
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export async function importPublicationTemplate(db: Db, file: PublicationTemplateFile, actorId: string, apply: boolean): Promise<TemplateImportPlan> {
  const { docType } = file.template
  const current = { where: { docType, isCurrent: true, retiredAt: null }, orderBy: { version: 'desc' as const } }
  const nextVersion = async (t: { aggregate(a: unknown): Promise<{ _max: { version: number | null } }> }) =>
    ((await t.aggregate({ where: { docType }, _max: { version: true } }))._max.version ?? 0) + 1

  // --- sections template ---
  const sections = file.sections.map(s => ({ ...s }))
  const curTpl = await db.publicationTemplate.findFirst(current)
  let template: Step
  if (curTpl && same(curTpl.sections, sections) && curTpl.label === file.template.label) {
    template = { action: 'unchanged', version: curTpl.version, id: curTpl.id }
  } else {
    const version = await nextVersion(db.publicationTemplate)
    template = { action: curTpl ? 'new_version' : 'create', version }
    if (apply) {
      if (curTpl) await db.publicationTemplate.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false } })
      template.id = (await db.publicationTemplate.create({ data: {
        docType, version, isCurrent: true, label: file.template.label, description: file.template.description,
        sections, createdBy: actorId, updatedBy: actorId,
      } })).id
    }
  }

  // --- checklist template ---
  let checklist: Step | null = null
  if (file.checklist.length > 0) {
    const curCk = await db.publicationChecklistTemplate.findFirst(current)
    if (curCk && same(curCk.items, file.checklist)) {
      checklist = { action: 'unchanged', version: curCk.version, id: curCk.id }
    } else {
      const version = await nextVersion(db.publicationChecklistTemplate)
      checklist = { action: curCk ? 'new_version' : 'create', version }
      if (apply) {
        if (curCk) await db.publicationChecklistTemplate.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false } })
        checklist.id = (await db.publicationChecklistTemplate.create({ data: {
          docType, version, isCurrent: true, items: file.checklist, createdBy: actorId, updatedBy: actorId,
        } })).id
      }
    }
  }

  // --- policy: point the docType at the template + checklist ---
  const curPol = await db.publicationTypePolicy.findFirst(current)
  const guidelineKey = file.template.guidelineKey ?? curPol?.guidelineKey ?? null
  const pointsRight = curPol && template.action === 'unchanged' && (checklist?.action ?? 'unchanged') === 'unchanged'
    && curPol.templateId === template.id && curPol.checklistTemplateId === (checklist?.id ?? curPol.checklistTemplateId)
    && curPol.guidelineKey === guidelineKey
  let policy: Step
  if (pointsRight) {
    policy = { action: 'unchanged', version: curPol!.version, id: curPol!.id }
  } else {
    const version = await nextVersion(db.publicationTypePolicy)
    policy = { action: curPol ? 'new_version' : 'create', version }
    if (apply) {
      if (curPol) await db.publicationTypePolicy.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false, supersededBy: `v${version}` } })
      policy.id = (await db.publicationTypePolicy.create({ data: {
        docType, version, isCurrent: true,
        templateId: template.id ?? null,
        checklistTemplateId: checklist?.id ?? curPol?.checklistTemplateId ?? null,
        guidelineKey,
        // Keep the AI / best-practice fallbacks an earlier policy version carried.
        ...(curPol && { smePrompt: curPol.smePrompt, bestPracticeDigest: curPol.bestPracticeDigest, sectionRules: curPol.sectionRules }),
        createdBy: actorId, updatedBy: actorId,
      } })).id
    }
  }

  return { docType, template, checklist, policy }
}
