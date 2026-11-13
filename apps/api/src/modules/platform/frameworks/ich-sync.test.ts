// ICH sync: reads ICH's guideline pages (admin.ich.org content API behind www.ich.org/page/ich-guidelines) and writes
// one registry row per guideline. The fixture below has the same shape ICH returns (guideline paragraphs nested in
// accordion groups); no network is used.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { parseIchDate, parseIchPage, syncIchGuidelines, type FetchJson } from './ich-sync.js'
import { frameworksRoutes } from './routes.js'

const guideline = (code: string, title: string, status: string, stepDate: string | undefined, pdf?: string) => ({
  code, title, status, details: { stepDate },
  fileGroups: pdf ? [{ title: 'Guideline', files: [{ title: code, uri: pdf, mimetype: 'application/pdf' }] }] : [],
})
const page = (...items: unknown[]) => ({
  items: [{ entityInfo: { bundle: 'page' }, mainWidgets: [{ entityInfo: { bundle: 'accordion_group' }, children: [{ entityInfo: { bundle: 'guideline' }, items }] }] }],
})
const PAGES: Record<string, unknown> = {
  quality:           page(guideline('Q1A(R2)', 'Stability Testing of New Drug Substances and Products', 'Step 5', '6 February 2003', 'https://database.ich.org/sites/default/files/Q1A%28R2%29%20Guideline.pdf'),
                          guideline('Q1F', 'Stability Data Package for Registration Applications in Climatic Zones III and IV', 'Withdrawn', '6 February 2003'),
                          guideline('Q13', 'Continuous Manufacturing', 'Step 5', '16 November 2022')),
  safety:            page(guideline('S13 EWG', 'Oncology', '', undefined)),
  efficacy:          page(guideline('E3', 'Structure and Content of Clinical Study Reports', 'Step 5', '30 November 1995', 'https://database.ich.org/sites/default/files/E3_Guideline.pdf'),
                          guideline('E6(R3)', '  Good Clinical  Practice ', 'Step 4', '6 January 2025')),
  multidisciplinary: page(guideline('Q13', 'Continuous Manufacturing', 'Step 5', '16 November 2022')),
}
const fetchJson: FetchJson = async (url) => PAGES[url.match(/page\/([a-z]+)-guidelines/)![1]!]

describe('reading ICH pages', () => {
  it('reads the code, title, step, date, category and PDF link of every guideline', () => {
    const rows = parseIchPage(PAGES.efficacy, 'efficacy')
    expect(rows).toEqual([
      { code: 'E3', title: 'Structure and Content of Clinical Study Reports', step: 'Step 5', stepDate: '1995-11-30', category: 'efficacy', sourceUrl: 'https://database.ich.org/sites/default/files/E3_Guideline.pdf' },
      { code: 'E6(R3)', title: 'Good Clinical Practice', step: 'Step 4', stepDate: '2025-01-06', category: 'efficacy', sourceUrl: 'https://www.ich.org/page/efficacy-guidelines' },
    ])
  })
  it('parses ICH dates', () => {
    expect(parseIchDate('27 October 1994')).toBe('1994-10-27')
    expect(parseIchDate('')).toBeNull()
    expect(parseIchDate('Q3 2025')).toBeNull()
  })
})

function fakePrisma(rows: Array<Record<string, unknown>> = []) {
  const db = rows.map(r => ({ id: `id-${r.name}`, version: 'r1', category: 'clinical', description: null, sourceUrl: null, effectiveDate: new Date('2020-01-01'), retiredAt: null, jurisdiction: 'ICH', ...r }))
  return {
    db,
    regulatoryFramework: {
      findMany: vi.fn(async ({ where }: { where: { jurisdiction: string } }) => db.filter(r => r.jurisdiction === where.jurisdiction)),
      create:   vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.push({ id: `id-${data.name}`, ...data } as never); return data }),
      update:   vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(db.find(r => r.id === where.id)!, data); return data }),
    },
  }
}

describe('syncing into the registry', () => {
  it('creates one row per dated guideline, retires withdrawn ones, and reports what it skipped', async () => {
    const prisma = fakePrisma()
    const r = await syncIchGuidelines(prisma, 'u-admin', fetchJson)
    expect(r.fetched).toBe(7)
    expect(r.created.sort()).toEqual(['ICH E3', 'ICH E6(R3)', 'ICH Q13', 'ICH Q1A(R2)', 'ICH Q1F'])
    expect(r.withdrawn).toEqual(['ICH Q1F'])
    expect(r.skipped).toEqual([
      { code: 'S13 EWG', reason: 'in progress, no step date yet' },
      { code: 'Q13', reason: 'listed twice by ICH; kept the first listing' },
    ])
    const e3 = prisma.db.find(x => x.name === 'ICH E3')!
    expect(e3).toMatchObject({ jurisdiction: 'ICH', description: 'Structure and Content of Clinical Study Reports', version: 'Step 5', category: 'efficacy', createdBy: 'u-admin', retiredAt: null })
    expect((e3.effectiveDate as Date).toISOString().slice(0, 10)).toBe('1995-11-30')
    expect(prisma.db.find(x => x.name === 'ICH Q1F')!.retiredAt).toBeInstanceOf(Date)
  })

  it('updates an existing ICH row in place, leaves unchanged ones alone, and never revives a superseded one', async () => {
    const retired = new Date('2026-11-13')
    const prisma = fakePrisma([
      { name: 'ICH E3', description: 'old title' },
      { name: 'ICH Q13', description: 'Continuous Manufacturing', version: 'Step 5', category: 'quality', sourceUrl: 'https://www.ich.org/page/quality-guidelines', effectiveDate: new Date('2022-11-16'), retiredAt: retired },
    ])
    const r = await syncIchGuidelines(prisma, 'u-admin', fetchJson)
    expect(r.updated).toContain('ICH E3')
    expect(prisma.db.find(x => x.name === 'ICH E3')).toMatchObject({ description: 'Structure and Content of Clinical Study Reports', version: 'Step 5' })
    expect(r.unchanged).toBe(1)                                                   // ICH Q13
    expect(prisma.db.find(x => x.name === 'ICH Q13')!.retiredAt).toBe(retired)
    expect(r.created).not.toContain('ICH E3')
  })
})

describe('POST /sync-ich', () => {
  async function build(role: string) {
    const app = Fastify()
    app.decorate('prisma', fakePrisma() as never)
    app.decorate('audit', { append: vi.fn(async () => {}) } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => { Object.assign(r, { user: { id: 'u-1', email: 'u@x.io', role, modules: ['A'], tenantId: null } as AuthenticatedUser }) })
    await app.register(frameworksRoutes)
    await app.ready()
    return app
  }
  it.each([['pm'], ['qc'], ['contributor']])('%s cannot run it (403)', async (role) => {
    const app = await build(role)
    expect((await app.inject({ method: 'POST', url: '/sync-ich' })).statusCode).toBe(403)
    await app.close()
  })
  it('says so, and changes nothing, when ich.org cannot be reached', async () => {
    const app = await build('admin')
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const res = await app.inject({ method: 'POST', url: '/sync-ich' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'ich_unreachable' })
    spy.mockRestore()
    await app.close()
  })
})
