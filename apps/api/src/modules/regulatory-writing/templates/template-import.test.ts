// Module D template import: validates authored JSON schema accepts
// per-section instructions + guidance + formatRules, creates the three
// coupled rows (template + checklist + policy), and respects idempotency
// / versioning.

import { describe, expect, it } from 'vitest'
import { importRegulatoryDocumentTemplate, regulatoryDocumentTemplateFileSchema, type RegulatoryDocumentTemplateFile } from './template-import.js'

const CTD_M25_FILE: RegulatoryDocumentTemplateFile = {
  schemaVersion: 1,
  template: {
    docType:         'ctd_m2_5_clinical_overview',
    label:           'CTD M2.5 Clinical Overview',
    description:     'Clinical overview following ICH M4E structure',
    regulatoryTrack: 'nda',
  },
  sections: [
    { id: 'product_development', number: '2.5.1', title: 'Product Development Rationale', guidance: 'Summarise the clinical development programme.' },
    { id: 'biopharm',            number: '2.5.2', title: 'Overview of Biopharmaceutics', instructions: 'Cover formulation changes, bioequivalence studies, dosage comparisons.' },
    { id: 'clin_pharm',          number: '2.5.3', title: 'Overview of Clinical Pharmacology' },
    { id: 'efficacy',            number: '2.5.4', title: 'Overview of Efficacy', instructions: 'Include pivotal trial results, dose-response, population subgroups.', guidance: 'Cite CSR tables by exact §x.y.z.' },
    { id: 'safety',              number: '2.5.5', title: 'Overview of Safety' },
    { id: 'benefits_risks',      number: '2.5.6', title: 'Benefits and Risks Conclusions', formatRules: 'Use tables for benefit/risk balance. Cite references in Vancouver style.' },
    { id: 'literature',          number: '2.5.7', title: 'Literature References' },
  ],
  checklist: [
    { id: 'csr_cited',   label: 'All major CSR tables cited', required: true, groupId: 'must' },
    { id: 'ich_m4e',     label: 'Follows ICH M4E structure',  required: true, groupId: 'must' },
    { id: 'readability', label: 'Reviewer-friendly tone',     required: false, groupId: 'note' },
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
  regulatoryDocumentTemplate:          table('tpl'),
  regulatoryDocumentChecklistTemplate: table('ck'),
  regulatoryTypePolicy:                table('pol'),
})

describe('importRegulatoryDocumentTemplate — authored JSON contract', () => {
  it('creates template + checklist + policy on first import, carrying per-section guidance verbatim', async () => {
    const db = fakeDb()
    const plan = await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', true)
    expect(plan).toMatchObject({
      template:  { action: 'create', version: 1 },
      checklist: { action: 'create', version: 1 },
      policy:    { action: 'create', version: 1 },
    })
    const [tpl] = db.regulatoryDocumentTemplate.rows
    const sections = tpl!.sections as Array<Record<string, unknown>>
    expect(sections[1]!.instructions).toMatch(/bioequivalence/)
    expect(sections[3]!.guidance).toMatch(/CSR tables/)
    expect(sections[5]!.formatRules).toMatch(/Vancouver/)
    const [pol] = db.regulatoryTypePolicy.rows
    expect(pol).toMatchObject({
      docType: 'ctd_m2_5_clinical_overview',
      templateId: plan.template.id,
      checklistTemplateId: plan.checklist!.id,
      regulatoryTrack: 'nda',
    })
  })

  it('is idempotent: re-importing identical content leaves everything unchanged', async () => {
    const db = fakeDb()
    await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', true)
    const again = await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', true)
    expect(again).toMatchObject({
      template:  { action: 'unchanged' },
      checklist: { action: 'unchanged' },
      policy:    { action: 'unchanged' },
    })
  })

  it('tolerates Postgres jsonb key reordering on re-read', async () => {
    const db = fakeDb()
    await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', true)
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v
    const tpl = db.regulatoryDocumentTemplate.rows[0]!; tpl.sections = reorder(tpl.sections)
    const again = await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', false)
    expect(again.template.action).toBe('unchanged')
  })

  it('creates a new template version when section content changes, bumps the policy and keeps its AI fallbacks', async () => {
    const db = fakeDb()
    await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', true)
    Object.assign(db.regulatoryTypePolicy.rows[0]!, { smePrompt: 'carry me over', sectionRules: { efficacy: [] } })
    const changed: RegulatoryDocumentTemplateFile = {
      ...CTD_M25_FILE,
      sections: CTD_M25_FILE.sections.map((s, i) => i === 3 ? { ...s, title: 'Overview of Efficacy (revised for M4E 2024)' } : s),
    }
    const plan = await importRegulatoryDocumentTemplate(db as never, changed, 'sys', true)
    expect(plan.template.action).toBe('new_version')
    expect(plan.policy.action).toBe('new_version')
    const currentPolicy = db.regulatoryTypePolicy.rows.find(r => r.isCurrent)!
    expect(currentPolicy).toMatchObject({ templateId: plan.template.id, smePrompt: 'carry me over' })
    expect(db.regulatoryTypePolicy.rows.find(r => !r.isCurrent)).toMatchObject({ supersededBy: 'v2' })
  })

  it('rejects malformed section ids and overlong fields at schema validation', () => {
    const badId = { ...CTD_M25_FILE, sections: [{ id: 'BAD id', number: '1', title: 'X' }] }
    expect(regulatoryDocumentTemplateFileSchema.safeParse(badId).success).toBe(false)

    const overlong = {
      ...CTD_M25_FILE,
      sections: [{ ...CTD_M25_FILE.sections[0]!, instructions: 'x'.repeat(5_000) }],
    }
    expect(regulatoryDocumentTemplateFileSchema.safeParse(overlong).success).toBe(false)
  })

  it('dry-run writes nothing', async () => {
    const db = fakeDb()
    const plan = await importRegulatoryDocumentTemplate(db as never, CTD_M25_FILE, 'sys', false)
    expect(plan.template.action).toBe('create')
    expect(db.regulatoryDocumentTemplate.rows).toHaveLength(0)
    expect(db.regulatoryTypePolicy.rows).toHaveLength(0)
  })
})
