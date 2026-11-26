// Module E template import: validates authored JSON schema accepts
// per-section instructions + guidance + formatRules, creates the three
// coupled rows (template + checklist + policy), and respects idempotency
// / versioning.

import { describe, expect, it } from 'vitest'
import { importIdeationArtefactTemplate, ideationArtefactTemplateFileSchema, type IdeationArtefactTemplateFile } from './template-import.js'

const PATIENT_STORY_FILE: IdeationArtefactTemplateFile = {
  schemaVersion: 1,
  template: {
    docType:     'patient_story',
    label:       'Patient Story',
    description: 'First-person patient narrative for disease-awareness campaigns',
    channelHint: 'patient',
  },
  sections: [
    { id: 'intro',      number: '1', title: 'Introduction',           guidance: 'Humanise with first-person framing; avoid clinical jargon.' },
    { id: 'journey',    number: '2', title: 'Diagnosis Journey',      instructions: 'Cover symptoms, time to diagnosis, emotional impact.' },
    { id: 'treatment',  number: '3', title: 'Treatment Experience' },
    { id: 'outcome',    number: '4', title: 'Outcome and Advice',     instructions: 'Keep hopeful; avoid product claims.', guidance: 'Close with one line of advice to other patients.' },
    { id: 'consent',    number: '5', title: 'Consent and Disclosures', formatRules: 'Must appear verbatim. Include signature date and witness name.' },
  ],
  checklist: [
    { id: 'patient_consent', label: 'Written patient consent on file', required: true,  groupId: 'must' },
    { id: 'anonymisation',   label: 'All identifying details anonymised unless consented', required: true, groupId: 'must' },
    { id: 'readability',     label: 'FK grade ≤ 8',                    required: false, groupId: 'note' },
  ],
}

type R = Record<string, unknown> & { id: string; docType: string; version: number; isCurrent: boolean }
function table(prefix: string) {
  const rows: R[] = []
  let n = 0
  const match = (r: R, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => (v === null ? r[k] == null : r[k] === v))
  return {
    rows,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter(r => match(r, where)).sort((a, b) => b.version - a.version)[0] ?? null,
    aggregate: async ({ where }: { where: Record<string, unknown> }) =>
      ({ _max: { version: rows.filter(r => match(r, where)).reduce<number | null>((m, r) => Math.max(m ?? 0, r.version), null) } }),
    create: async ({ data }: { data: Record<string, unknown> }) => { const r = { retiredAt: null, ...data, id: `${prefix}-${++n}` } as R; rows.push(r); return r },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { rows.filter(r => match(r, where)).forEach(r => Object.assign(r, data)) },
  }
}
const fakeDb = () => ({
  ideationArtefactTemplate:          table('tpl'),
  ideationArtefactChecklistTemplate: table('ck'),
  ideationTypePolicy:                table('pol'),
})

describe('importIdeationArtefactTemplate — authored JSON contract', () => {
  it('creates template + checklist + policy on first import, carrying per-section guidance verbatim', async () => {
    const db = fakeDb()
    const plan = await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', true)
    expect(plan).toMatchObject({
      template:  { action: 'create', version: 1 },
      checklist: { action: 'create', version: 1 },
      policy:    { action: 'create', version: 1 },
    })
    const [tpl] = db.ideationArtefactTemplate.rows
    const sections = tpl!.sections as Array<Record<string, unknown>>
    expect(sections[0]!.guidance).toMatch(/first-person/)
    expect(sections[1]!.instructions).toMatch(/symptoms/)
    expect(sections[4]!.formatRules).toMatch(/verbatim/)
    const [pol] = db.ideationTypePolicy.rows
    expect(pol).toMatchObject({
      docType: 'patient_story',
      templateId: plan.template.id,
      checklistTemplateId: plan.checklist!.id,
      channelHint: 'patient',
    })
  })

  it('is idempotent: re-importing identical content leaves everything unchanged', async () => {
    const db = fakeDb()
    await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', true)
    const again = await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', true)
    expect(again).toMatchObject({
      template:  { action: 'unchanged' },
      checklist: { action: 'unchanged' },
      policy:    { action: 'unchanged' },
    })
  })

  it('tolerates Postgres jsonb key reordering on re-read', async () => {
    const db = fakeDb()
    await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', true)
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v
    const tpl = db.ideationArtefactTemplate.rows[0]!; tpl.sections = reorder(tpl.sections)
    const again = await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', false)
    expect(again.template.action).toBe('unchanged')
  })

  it('creates a new template version when section content changes, bumps the policy and keeps its AI fallbacks', async () => {
    const db = fakeDb()
    await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', true)
    Object.assign(db.ideationTypePolicy.rows[0]!, { smePrompt: 'carry me over', sectionRules: { journey: [] } })
    const changed: IdeationArtefactTemplateFile = {
      ...PATIENT_STORY_FILE,
      sections: PATIENT_STORY_FILE.sections.map((s, i) => i === 1 ? { ...s, title: 'Diagnosis and Early Treatment Journey' } : s),
    }
    const plan = await importIdeationArtefactTemplate(db as never, changed, 'sys', true)
    expect(plan.template.action).toBe('new_version')
    expect(plan.policy.action).toBe('new_version')
    const currentPolicy = db.ideationTypePolicy.rows.find(r => r.isCurrent)!
    expect(currentPolicy).toMatchObject({ templateId: plan.template.id, smePrompt: 'carry me over' })
    expect(db.ideationTypePolicy.rows.find(r => !r.isCurrent)).toMatchObject({ supersededBy: 'v2' })
  })

  it('rejects malformed section ids and overlong fields at schema validation', () => {
    const badId = { ...PATIENT_STORY_FILE, sections: [{ id: 'BAD id', number: '1', title: 'X' }] }
    expect(ideationArtefactTemplateFileSchema.safeParse(badId).success).toBe(false)

    const overlong = {
      ...PATIENT_STORY_FILE,
      sections: [{ ...PATIENT_STORY_FILE.sections[0]!, instructions: 'x'.repeat(5_000) }],
    }
    expect(ideationArtefactTemplateFileSchema.safeParse(overlong).success).toBe(false)
  })

  it('dry-run writes nothing', async () => {
    const db = fakeDb()
    const plan = await importIdeationArtefactTemplate(db as never, PATIENT_STORY_FILE, 'sys', false)
    expect(plan.template.action).toBe('create')
    expect(db.ideationArtefactTemplate.rows).toHaveLength(0)
    expect(db.ideationTypePolicy.rows).toHaveLength(0)
  })
})
