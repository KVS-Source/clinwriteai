// Module C template import: validates the authored JSON schema accepts
// per-section instructions + guidance + formatRules, creates the three
// coupled rows (template + checklist + policy) in one call, and respects
// idempotency / versioning conventions.

import { describe, expect, it } from 'vitest'
import { importMedContentTemplate, medContentTemplateFileSchema, type MedContentTemplateFile } from './template-import.js'

const PIL_FILE: MedContentTemplateFile = {
  schemaVersion: 1,
  template: {
    docType:         'pil',
    label:           'Patient Information Leaflet (EMA QRD)',
    description:     'Plain-language patient leaflet template',
    complianceTrack: 'non_promotional',
  },
  sections: [
    { id: 'what_is',      number: '1', title: 'What is the medicine?',   guidance: 'Use short sentences; avoid medical jargon.' },
    { id: 'before_take',  number: '2', title: 'Before you take it',      instructions: 'Cover contraindications, warnings, interactions.' },
    { id: 'how_to_take',  number: '3', title: 'How to take it',          guidance: 'Include dose, timing, missed dose, overdose.' },
    { id: 'side_effects', number: '4', title: 'Possible side effects',   instructions: 'List by frequency (common / uncommon / rare).', guidance: 'Define medical terms on first use.' },
    { id: 'storage',      number: '5', title: 'Storage',                 formatRules:  'Short paragraphs. Temperature specifics.' },
  ],
  checklist: [
    { id: 'readability', label: 'Flesch-Kincaid grade ≤ 8',          required: true,  groupId: 'must' },
    { id: 'ema_qrd',     label: 'Follows EMA QRD section order',     required: true,  groupId: 'must' },
    { id: 'glossary',    label: 'Glossary attached',                  required: false, groupId: 'note' },
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
  medContentTemplate:          table('tpl'),
  medContentChecklistTemplate: table('ck'),
  medContentTypePolicy:        table('pol'),
})

describe('importMedContentTemplate — authored JSON contract', () => {
  it('creates template + checklist + policy on first import, carrying per-section guidance verbatim', async () => {
    const db = fakeDb()
    const plan = await importMedContentTemplate(db as never, PIL_FILE, 'sys', true)
    expect(plan).toMatchObject({
      template:  { action: 'create', version: 1 },
      checklist: { action: 'create', version: 1 },
      policy:    { action: 'create', version: 1 },
    })
    const [tpl] = db.medContentTemplate.rows
    const sections = tpl!.sections as Array<Record<string, unknown>>
    expect(sections[1]!.instructions).toMatch(/contraindications/)
    expect(sections[3]!.guidance).toMatch(/Define medical terms/)
    expect(sections[4]!.formatRules).toMatch(/Temperature/)
    const [pol] = db.medContentTypePolicy.rows
    expect(pol).toMatchObject({
      docType: 'pil',
      templateId: plan.template.id,
      checklistTemplateId: plan.checklist!.id,
      complianceTrack: 'non_promotional',
    })
  })

  it('is idempotent: re-importing identical content leaves everything unchanged', async () => {
    const db = fakeDb()
    await importMedContentTemplate(db as never, PIL_FILE, 'sys', true)
    const again = await importMedContentTemplate(db as never, PIL_FILE, 'sys', true)
    expect(again).toMatchObject({
      template:  { action: 'unchanged' },
      checklist: { action: 'unchanged' },
      policy:    { action: 'unchanged' },
    })
    expect(db.medContentTemplate.rows).toHaveLength(1)
  })

  it('tolerates Postgres jsonb key reordering on re-read (canonical comparator)', async () => {
    const db = fakeDb()
    await importMedContentTemplate(db as never, PIL_FILE, 'sys', true)
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v
    const tpl = db.medContentTemplate.rows[0]!; tpl.sections = reorder(tpl.sections)
    const again = await importMedContentTemplate(db as never, PIL_FILE, 'sys', false)
    expect(again.template.action).toBe('unchanged')
  })

  it('creates a new template version when section content changes, and bumps the policy to point at it', async () => {
    const db = fakeDb()
    await importMedContentTemplate(db as never, PIL_FILE, 'sys', true)
    Object.assign(db.medContentTypePolicy.rows[0]!, { smePrompt: 'carry me over', sectionRules: { what_is: [] } })
    const changed: MedContentTemplateFile = {
      ...PIL_FILE,
      sections: PIL_FILE.sections.map((s, i) => i === 0 ? { ...s, title: 'What is this medicine? (revised)' } : s),
    }
    const plan = await importMedContentTemplate(db as never, changed, 'sys', true)
    expect(plan.template.action).toBe('new_version')
    expect(plan.template.version).toBe(2)
    expect(plan.policy.action).toBe('new_version')
    const policyRows = db.medContentTypePolicy.rows
    const currentPolicy = policyRows.find(r => r.isCurrent)!
    expect(currentPolicy).toMatchObject({ templateId: plan.template.id, smePrompt: 'carry me over' })
    expect(policyRows.find(r => !r.isCurrent)).toMatchObject({ supersededBy: 'v2' })
  })

  it('rejects malformed section ids and overlong fields at schema validation', () => {
    const badId = { ...PIL_FILE, sections: [{ id: 'BAD id', number: '1', title: 'X' }] }
    expect(medContentTemplateFileSchema.safeParse(badId).success).toBe(false)

    const overlong = {
      ...PIL_FILE,
      sections: [{ ...PIL_FILE.sections[0]!, instructions: 'x'.repeat(5_000) }],
    }
    expect(medContentTemplateFileSchema.safeParse(overlong).success).toBe(false)
  })

  it('dry-run writes nothing', async () => {
    const db = fakeDb()
    const plan = await importMedContentTemplate(db as never, PIL_FILE, 'sys', false)
    expect(plan.template.action).toBe('create')
    expect(db.medContentTemplate.rows).toHaveLength(0)
    expect(db.medContentTypePolicy.rows).toHaveLength(0)
  })
})
