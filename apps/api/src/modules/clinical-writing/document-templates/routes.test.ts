// Templates carry more than a section list: the hierarchy and guidance on each section, and a `spec` with
// the page layout, styles, standards and front / back matter. These tests pin that it is stored, returned,
// and not lost by an edit that doesn't mention it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({
  resolveAiEngineSettings: async () => ({ default: 'claude-test' }),
}))

import { documentTemplatesRoutes } from './routes.js'

type Row = Record<string, any>

function build() {
  const rows: Row[] = []
  const prisma = {
    documentTemplate: {
      findMany: async () => rows,
      findFirst: async ({ where }: Row) => rows.find(r => r.type === where.type && r.isCurrent && !r.retiredAt) ?? null,
      findUnique: async ({ where }: Row) => rows.find(r => r.id === where.id) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: `t${rows.length + 1}`, version: 1, isCurrent: true, supersededBy: null, retiredAt: null, spec: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        rows.push(row); return row
      },
      update: async ({ where, data }: Row) => {
        const row = rows.find(r => r.id === where.id)!
        Object.assign(row, data); row.updatedAt = new Date(); return row
      },
    },
  }
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: async () => ({ id: '1', rowHash: 'h' }) } as never)
  app.decorate('aiGateway', { isConfigured: () => true } as never)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: Row }).user = { id: 'u-pm', email: 'pm@x.test', role: 'pm', modules: ['A'], tenantId: null }
  })
  return { app, rows, ready: app.register(documentTemplatesRoutes) }
}

const richSections = [
  { id: 'm11-1', number: '1', title: 'Protocol Summary', level: 1, parentId: null, instructions: 'Provide a concise synopsis of the entire study.', hasSubsections: true },
  { id: 'm11-1-1', number: '1.1', title: 'Protocol Synopsis', level: 2, parentId: 'm11-1', guidance: 'Study design, population, sample size.', templateText: '[Information Required] Study design, population, sample size.', placeholder: '[Information Required]', defaultContentHtml: '<p>[Information Required] Study design.</p>', futureField: 'kept' },
  { id: 'm11-1-3', number: '1.3', title: 'Schedule of Activities', level: 2, parentId: 'm11-1', tables: [{ role: 'scheduleOfActivities', headerRow: ['Assessment', 'Screening'], rows: [['Consent', 'X']] }] },
]
const spec = { schemaVersion: 1, format: { page: { size: 'Letter' }, styles: { heading1: { font: 'Aptos Display', sizePt: 13, color: '#14466E' } } }, writingStandards: [{ id: 'citations-vancouver', rule: 'Use Vancouver style.' }] }
const base = { type: 'protocol', label: 'Protocol', description: 'd', framework: 'ICH M11' }

describe('document templates: sections with hierarchy and a spec', () => {
  let t: ReturnType<typeof build>
  beforeEach(async () => { t = build(); await t.ready })

  it('stores the hierarchy, guidance, tables and spec, and returns them', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/', payload: { ...base, sections: richSections, spec } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.spec).toEqual(spec)
    expect(body.sections[1]).toMatchObject({ level: 2, parentId: 'm11-1', guidance: 'Study design, population, sample size.', placeholder: '[Information Required]' })
    expect(body.sections[1].futureField).toBe('kept')            // a field the schema doesn't know yet is not dropped
    expect(body.sections[2].tables[0].role).toBe('scheduleOfActivities')
    const fetched = (await t.app.inject({ method: 'GET', url: '/protocol' })).json()
    expect(fetched.spec).toEqual(spec)
  })

  it('a plain section list still works and has no spec', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/', payload: { ...base, type: 'plain', sections: [{ id: 'p1', number: '§1', title: 'One' }] } })
    expect(res.statusCode).toBe(201)
    expect(res.json().spec).toBeNull()
    expect(res.json().sections).toEqual([{ id: 'p1', number: '§1', title: 'One' }])
  })

  it('editing only the label leaves the sections and the spec alone', async () => {
    const id = (await t.app.inject({ method: 'POST', url: '/', payload: { ...base, sections: richSections, spec } })).json().id
    const res = await t.app.inject({ method: 'PATCH', url: `/${id}`, payload: { label: 'Protocol (ICH M11)' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().label).toBe('Protocol (ICH M11)')
    expect(res.json().spec).toEqual(spec)
    expect(res.json().sections).toHaveLength(3)
  })

  it('editing the sections does not wipe the spec; spec: null clears it', async () => {
    const id = (await t.app.inject({ method: 'POST', url: '/', payload: { ...base, sections: richSections, spec } })).json().id
    const edited = await t.app.inject({ method: 'PATCH', url: `/${id}`, payload: { sections: richSections.slice(0, 2) } })
    expect(edited.json().sections).toHaveLength(2)
    expect(edited.json().spec).toEqual(spec)
    const cleared = await t.app.inject({ method: 'PATCH', url: `/${id}`, payload: { spec: null } })
    expect(cleared.statusCode).toBe(200)
    expect(t.rows[0]!.spec).not.toEqual(spec)                       // cleared (stored as a JSON null)
  })

  it('refuses a spec that is too large and a section with a bad level', async () => {
    const big = { blob: 'x'.repeat(500_001) }
    expect((await t.app.inject({ method: 'POST', url: '/', payload: { ...base, type: 'big', spec: big } })).statusCode).toBe(400)
    expect((await t.app.inject({ method: 'POST', url: '/', payload: { ...base, type: 'bad', sections: [{ id: 's1', number: '1', title: 'T', level: 0 }] } })).statusCode).toBe(400)
  })
})

describe('document templates: catalogue auto-derive on create', () => {
  let t: ReturnType<typeof build>
  beforeEach(async () => { t = build(); await t.ready })

  it('type-only POST fills label / description / framework / requiredSourceCategories from the catalogue', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/', payload: { type: 'protocol' } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      type:                     'protocol',
      label:                    'Protocol',
      description:              'Study protocol — ICH E6(R3) GCP compliance.',
      framework:                'ICH E6(R3)',
      requiredSourceCategories: ['ib', 'regulatory'],
    })
  })

  it('an explicit label wins over the catalogue; the other fields still come from the catalogue', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/', payload: { type: 'csr-full', label: 'CSR (custom)' } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      type:        'csr-full',
      label:       'CSR (custom)',
      framework:   'ICH E3',                                           // from catalogue
      description: 'Full Clinical Study Report — ICH E3 structure.',   // from catalogue
    })
  })

  it('a type outside the catalogue still needs label / description / framework (400 lists what is missing)', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/', payload: { type: 'bespoke-type' } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'validation', missing: ['label', 'description', 'framework'] })
  })
})
