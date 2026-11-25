// Module D template import — authored JSON → RegulatoryDocumentTemplate
// + RegulatoryDocumentChecklistTemplate + RegulatoryTypePolicy pointer
// bump.
//
// Mirror of the Module C template-import adapted for the Regulatory
// schema (apps/api/src/modules/medical-writing/templates/template-import.ts).
// Called from admin tooling that loads a repo JSON file like
// docs/reg-templates/ctd-m25-clinical-overview.template.json.
//
// Idempotency: content identical to the current row leaves everything
// alone; changed content becomes a new version (the old one stays, no
// longer current). Dry-run (apply=false) returns the plan without
// writing.

import { z } from 'zod'

const sectionSchema = z.object({
  id:          z.string().regex(/^[a-z0-9_]+$/),
  number:      z.string().min(1),
  title:       z.string().min(1),
  // Migration 105 Package R-1: authored templates carry per-section
  // content-steering NL. Max 4 KB each — long enough for a real
  // guidance paragraph, short enough that RegulatoryDocumentTemplate.
  // sections[] JSON doesn't bloat past reasonable limits.
  instructions: z.string().max(4_000).optional(),
  guidance:     z.string().max(4_000).optional(),
  formatRules:  z.string().max(4_000).optional(),
  internal:     z.boolean().optional(),
  starterHtml:  z.string().optional(),
})

export const regulatoryDocumentTemplateFileSchema = z.object({
  schemaVersion: z.literal(1),
  template: z.object({
    docType:         z.string().regex(/^[a-z0-9_]+$/),
    label:           z.string().min(1),
    description:     z.string().default(''),
    regulatoryTrack: z.string().optional(),      // ind | nda | maa | bla | variation | null
  }),
  sections:  z.array(sectionSchema).min(1).refine(
    s => new Set(s.map(x => x.id)).size === s.length,
    'section ids must be unique',
  ),
  checklist: z.array(z.object({
    id:       z.string().min(1),
    label:    z.string().min(1),
    required: z.boolean(),
    groupId:  z.string().min(1),
    helpText: z.string().optional(),
  })).default([]),
}).passthrough()

export type RegulatoryDocumentTemplateFile = z.infer<typeof regulatoryDocumentTemplateFileSchema>

type Step = { action: 'create' | 'new_version' | 'unchanged'; version: number; id?: string }
export interface TemplateImportPlan { docType: string; template: Step; checklist: Step | null; policy: Step }

interface Row { id: string; version: number }
interface Db {
  regulatoryDocumentTemplate: {
    findFirst(a: unknown): Promise<(Row & { sections: unknown; label: string; description: string }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
  regulatoryDocumentChecklistTemplate: {
    findFirst(a: unknown): Promise<(Row & { items: unknown }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
  regulatoryTypePolicy: {
    findFirst(a: unknown): Promise<(Row & {
      templateId: string | null; checklistTemplateId: string | null;
      regulatoryTrack: string | null; smePrompt: string;
      bestPracticeDigest: unknown; sectionRules: unknown;
    }) | null>
    aggregate(a: unknown): Promise<{ _max: { version: number | null } }>
    create(a: unknown): Promise<Row>
    updateMany(a: unknown): Promise<unknown>
  }
}

// Postgres jsonb stores keys in its own order — the canonical
// comparator normalises so re-imports don't false-flag as "changed."
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]))
  : v
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export async function importRegulatoryDocumentTemplate(db: Db, file: RegulatoryDocumentTemplateFile, actorId: string, apply: boolean): Promise<TemplateImportPlan> {
  const { docType } = file.template
  const current = { where: { docType, isCurrent: true, retiredAt: null }, orderBy: { version: 'desc' as const } }
  const nextVersion = async (t: { aggregate(a: unknown): Promise<{ _max: { version: number | null } }> }) =>
    ((await t.aggregate({ where: { docType }, _max: { version: true } }))._max.version ?? 0) + 1

  // --- sections template ---
  const sections = file.sections.map(s => ({ ...s }))
  const curTpl = await db.regulatoryDocumentTemplate.findFirst(current)
  let template: Step
  if (curTpl && same(curTpl.sections, sections) && curTpl.label === file.template.label) {
    template = { action: 'unchanged', version: curTpl.version, id: curTpl.id }
  } else {
    const version = await nextVersion(db.regulatoryDocumentTemplate)
    template = { action: curTpl ? 'new_version' : 'create', version }
    if (apply) {
      if (curTpl) await db.regulatoryDocumentTemplate.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false } })
      template.id = (await db.regulatoryDocumentTemplate.create({ data: {
        docType, version, isCurrent: true, label: file.template.label, description: file.template.description,
        sections, createdBy: actorId, updatedBy: actorId,
      } })).id
    }
  }

  // --- checklist template ---
  let checklist: Step | null = null
  if (file.checklist.length > 0) {
    const curCk = await db.regulatoryDocumentChecklistTemplate.findFirst(current)
    if (curCk && same(curCk.items, file.checklist)) {
      checklist = { action: 'unchanged', version: curCk.version, id: curCk.id }
    } else {
      const version = await nextVersion(db.regulatoryDocumentChecklistTemplate)
      checklist = { action: curCk ? 'new_version' : 'create', version }
      if (apply) {
        if (curCk) await db.regulatoryDocumentChecklistTemplate.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false } })
        checklist.id = (await db.regulatoryDocumentChecklistTemplate.create({ data: {
          docType, version, isCurrent: true, items: file.checklist, createdBy: actorId, updatedBy: actorId,
        } })).id
      }
    }
  }

  // --- policy: point the docType at the template + checklist ---
  const curPol = await db.regulatoryTypePolicy.findFirst(current)
  const regulatoryTrack = file.template.regulatoryTrack ?? curPol?.regulatoryTrack ?? null
  const pointsRight = curPol && template.action === 'unchanged' && (checklist?.action ?? 'unchanged') === 'unchanged'
    && curPol.templateId === template.id && curPol.checklistTemplateId === (checklist?.id ?? curPol.checklistTemplateId)
    && curPol.regulatoryTrack === regulatoryTrack
  let policy: Step
  if (pointsRight) {
    policy = { action: 'unchanged', version: curPol!.version, id: curPol!.id }
  } else {
    const version = await nextVersion(db.regulatoryTypePolicy)
    policy = { action: curPol ? 'new_version' : 'create', version }
    if (apply) {
      if (curPol) await db.regulatoryTypePolicy.updateMany({ where: { docType, isCurrent: true }, data: { isCurrent: false, supersededBy: `v${version}` } })
      policy.id = (await db.regulatoryTypePolicy.create({ data: {
        docType, version, isCurrent: true,
        templateId: template.id ?? null,
        checklistTemplateId: checklist?.id ?? curPol?.checklistTemplateId ?? null,
        regulatoryTrack,
        // Keep the AI / best-practice fallbacks an earlier policy version carried.
        ...(curPol && { smePrompt: curPol.smePrompt, bestPracticeDigest: curPol.bestPracticeDigest, sectionRules: curPol.sectionRules }),
        createdBy: actorId, updatedBy: actorId,
      } })).id
    }
  }

  return { docType, template, checklist, policy }
}
