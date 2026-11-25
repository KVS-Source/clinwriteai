// Module B template import: the repo's manuscript template file is valid and complete, and importing it creates
// template + checklist + policy once, leaves identical content alone, and versions changed content.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importPublicationTemplate, publicationTemplateFileSchema, type PublicationTemplateFile } from './template-import.js'

const FILE = fileURLToPath(new URL('../../../../../../docs/templates/manuscript-original-research.template.json', import.meta.url))
const load = (): PublicationTemplateFile => publicationTemplateFileSchema.parse(JSON.parse(readFileSync(FILE, 'utf8')))

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
  publicationTemplate: table('tpl'),
  publicationChecklistTemplate: table('ck'),
  publicationTypePolicy: table('pol'),
})

describe('the manuscript template file (from docs/ClinWrite_Master_Manuscript_Template.docx)', () => {
  it('is valid and has every manuscript section, in order, with starter text', () => {
    const f = load()
    expect(f.template.docType).toBe('manuscript_original_research')
    expect(f.sections.map(s => s.id)).toEqual(['title', 'abstract', 'intro', 'methods', 'results', 'discussion', 'conclusion', 'declarations', 'references', 'tables_figures', 'traceability'])
    for (const s of f.sections) expect(s.starterHtml, s.id).toMatch(/\S/)
    // Sub-headings and table shells come through.
    const methods = f.sections.find(s => s.id === 'methods')!.starterHtml!
    expect(methods).toContain('<h3>4.1 Study design and oversight</h3>')
    expect(methods).toContain('<h3>4.9 Protocol amendments and deviations</h3>')
    expect(f.sections.find(s => s.id === 'tables_figures')!.starterHtml).toContain('<p><strong>Table 3. Summary of treatment-emergent adverse events</strong></p><table>')
    expect(f.sections.find(s => s.id === 'results')!.guidance).toMatch(/Do not fabricate values/)
    expect(f.sections.find(s => s.id === 'traceability')!.internal).toBe(true)
    expect(f.checklist).toHaveLength(10)
  })
})

describe('importing a publication template', () => {
  it('a dry run writes nothing and says what it would create', async () => {
    const db = fakeDb()
    const plan = await importPublicationTemplate(db as never, load(), 'sys', false)
    expect(plan).toMatchObject({ template: { action: 'create', version: 1 }, checklist: { action: 'create', version: 1 }, policy: { action: 'create', version: 1 } })
    expect(db.publicationTemplate.rows).toHaveLength(0)
    expect(db.publicationTypePolicy.rows).toHaveLength(0)
  })

  it('creates the template, checklist and a policy pointing at both', async () => {
    const db = fakeDb()
    const plan = await importPublicationTemplate(db as never, load(), 'sys', true)
    const [tpl] = db.publicationTemplate.rows
    const [pol] = db.publicationTypePolicy.rows
    expect(tpl).toMatchObject({ docType: 'manuscript_original_research', version: 1, isCurrent: true, label: 'Original Research Manuscript', createdBy: 'sys' })
    expect((tpl!.sections as unknown[]).length).toBe(11)
    expect(pol).toMatchObject({ docType: 'manuscript_original_research', version: 1, templateId: plan.template.id, checklistTemplateId: plan.checklist!.id, guidelineKey: 'CONSORT' })
  })

  it('leaves identical content alone when run again', async () => {
    const db = fakeDb()
    await importPublicationTemplate(db as never, load(), 'sys', true)
    const again = await importPublicationTemplate(db as never, load(), 'sys', true)
    expect(again).toMatchObject({ template: { action: 'unchanged' }, checklist: { action: 'unchanged' }, policy: { action: 'unchanged' } })
    expect(db.publicationTemplate.rows).toHaveLength(1)
    expect(db.publicationTypePolicy.rows).toHaveLength(1)
  })

  // Found against the real database: Postgres jsonb hands objects back with their keys in its own order.
  it('still sees identical content when the database returns the JSON keys in a different order', async () => {
    const db = fakeDb()
    await importPublicationTemplate(db as never, load(), 'sys', true)
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v
    const tpl = db.publicationTemplate.rows[0]!; tpl.sections = reorder(tpl.sections)
    const ck = db.publicationChecklistTemplate.rows[0]!; ck.items = reorder(ck.items)
    const again = await importPublicationTemplate(db as never, load(), 'sys', false)
    expect(again).toMatchObject({ template: { action: 'unchanged' }, checklist: { action: 'unchanged' }, policy: { action: 'unchanged' } })
  })

  it('versions changed content: the old template stays, the policy moves to the new one and keeps its AI fallbacks', async () => {
    const db = fakeDb()
    await importPublicationTemplate(db as never, load(), 'sys', true)
    Object.assign(db.publicationTypePolicy.rows[0]!, { smePrompt: 'keep me', sectionRules: { methods: [] } })
    const changed = load()
    changed.sections[0] = { ...changed.sections[0]!, title: 'Title page (revised)' }
    const plan = await importPublicationTemplate(db as never, changed, 'sys', true)
    expect(plan).toMatchObject({ template: { action: 'new_version', version: 2 }, checklist: { action: 'unchanged' }, policy: { action: 'new_version', version: 2 } })
    expect(db.publicationTemplate.rows.map(r => [r.version, r.isCurrent])).toEqual([[1, false], [2, true]])
    const current = db.publicationTypePolicy.rows.find(r => r.isCurrent)!
    expect(current).toMatchObject({ templateId: plan.template.id, smePrompt: 'keep me', sectionRules: { methods: [] } })
    expect(db.publicationTypePolicy.rows.find(r => !r.isCurrent)).toMatchObject({ supersededBy: 'v2' })
  })

  it('refuses a file with duplicate section ids', () => {
    const bad = { ...load(), sections: [{ id: 'a', number: '1', title: 'A' }, { id: 'a', number: '2', title: 'B' }] }
    expect(publicationTemplateFileSchema.safeParse(bad).success).toBe(false)
  })

  // Package B-1 (migration 105): the schema accepts per-section
  // `instructions` + `guidance` + `formatRules` so authored JSON
  // carries the same content steering the Clinical distiller extracts
  // from a PDF. All three are optional — authored templates can supply
  // any combination.
  describe('migration 105 — instructions + guidance + formatRules authoring', () => {
    it('accepts instructions + guidance + formatRules when present and persists them verbatim', async () => {
      const db = fakeDb()
      const f = load()
      f.sections[0] = {
        ...f.sections[0]!,
        instructions: 'Include the manuscript short title, journal target, and corresponding author.',
        guidance:     'Keep the title under 25 words; avoid declarative claims of superiority.',
        formatRules:  'Font: Times New Roman 12 pt.\nParagraph: double-spaced, flush left.',
      }
      const plan = await importPublicationTemplate(db as never, f, 'sys', true)
      expect(plan.template.action).toBe('create')
      const [tpl] = db.publicationTemplate.rows
      const section0 = (tpl!.sections as Array<Record<string, unknown>>)[0]!
      expect(section0.instructions).toMatch(/short title/)
      expect(section0.guidance).toMatch(/under 25 words/)
      expect(section0.formatRules).toMatch(/Times New Roman/)
    })

    it('leaves instructions undefined when the authored file omits it (fixture pre-dates migration 105)', async () => {
      const db = fakeDb()
      const plan = await importPublicationTemplate(db as never, load(), 'sys', true)
      expect(plan.template.action).toBe('create')
      const [tpl] = db.publicationTemplate.rows
      // The shipped fixture authors `guidance` for every section but
      // doesn't carry `instructions` yet (that field is new in
      // migration 105). Confirm the importer tolerates its absence
      // rather than silently defaulting to an empty string.
      for (const sec of tpl!.sections as Array<Record<string, unknown>>) {
        expect(sec.instructions).toBeUndefined()
      }
    })

    it('rejects an overlong instructions string (shape validation)', () => {
      const bad = load()
      bad.sections[0] = { ...bad.sections[0]!, instructions: 'x'.repeat(5_000) }
      expect(publicationTemplateFileSchema.safeParse(bad).success).toBe(false)
    })
  })
})

describe('a new publication from the imported template', () => {
  it('starts with every section and its starter text (sub-headings, placeholders, table shells)', async () => {
    const { templateSectionPayloads } = await import('./section-service.js')
    const payloads = templateSectionPayloads(load().sections)
    expect(payloads).toHaveLength(11)
    expect(payloads[0]).toMatchObject({ sectionId: 'title', sectionNumber: '1', sectionTitle: 'Title page' })
    expect(payloads.find(p => p.sectionId === 'methods')!.contentHtml).toContain('<h3>4.1 Study design and oversight</h3>')
    expect(payloads.find(p => p.sectionId === 'tables_figures')!.contentHtml).toContain('<table>')
  })
  it('a section without starter text starts empty; a non-list is ignored', async () => {
    const { templateSectionPayloads } = await import('./section-service.js')
    expect(templateSectionPayloads([{ id: 'a', number: '1', title: 'A' }])).toEqual([{ sectionId: 'a', sectionNumber: '1', sectionTitle: 'A' }])
    expect(templateSectionPayloads(null)).toEqual([])
  })
})
