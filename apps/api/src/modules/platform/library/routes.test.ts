// Library read routes via Fastify inject() against a fake Prisma — pins the
// filter / sort / paging translation, tenant visibility and best-practice
// create rules without touching a database.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'
import { libraryRoutes } from './routes.js'
import type { SectionRow } from './shape.js'

const section = (id: string, over: Partial<SectionRow> = {}): SectionRow => ({
  id, tenantId: null, title: `Item ${id}`, body: 'text', taTag: 'Oncology', framework: 'ICH E3', category: 'claim',
  version: 1, isCurrent: true, approvedBy: 'u1', approvedAt: new Date('2026-10-01T00:00:00Z'), retiredAt: null,
  tags: ['module:D'], updatedAt: new Date('2026-10-02T00:00:00Z'), ...over,
})

interface Setup { role?: Role | null; tenantId?: string | null; rows?: SectionRow[]; total?: number; ta?: string | null; dup?: boolean; tenantModules?: string[] }

async function build(setup: Setup = {}) {
  const findMany = vi.fn(async () => setup.rows ?? [])
  const count = vi.fn(async () => setup.total ?? (setup.rows ?? []).length)
  const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) =>
    'title' in args.where ? (setup.dup ? { id: 'dup' } : null) : (setup.rows ?? [])[0] ?? null)
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => section('new-1', {
    title: data.title as string, body: data.body as string, tags: data.tags as string[], category: 'best_practice',
    framework: data.framework as string, taTag: data.taTag as string, version: data.version as number,
  }))
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    librarySection: { findMany, count, findFirst, create },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'Dr James Hartley' }]) },
    project: { findMany: vi.fn(async () => [{ id: 'p1', name: 'VELORA-301', status: 'closed' }]) },
    document: { findMany: vi.fn(async () => []) },
    tenant: { findUnique: vi.fn(async () => (setup.tenantModules ? { modulesEnabled: setup.tenantModules } : null)) },
    therapeuticArea: { findFirst: vi.fn(async () => (setup.ta === null ? null : { label: setup.ta ?? 'Oncology' })) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  const role = setup.role === undefined ? 'admin' : setup.role
  app.addHook('onRequest', async (request) => {
    if (role === null) return
    const user: AuthenticatedUser = { id: 'u1', email: 'a@b.c', role, modules: [], tenantId: setup.tenantId ?? null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(libraryRoutes, { prefix: '/library' })
  await app.ready()
  return { app, findMany, count, create, append }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })
async function setup(s: Setup = {}) { const b = await build(s); current = b.app; return b }
const lastWhere = (m: ReturnType<typeof vi.fn>) => (m.mock.calls.at(-1)![0] as { where: { AND: unknown[] } }).where

describe('GET /library', () => {
  it('requires a signed-in user', async () => {
    const { app } = await setup({ role: null })
    expect((await app.inject({ method: 'GET', url: '/library' })).statusCode).toBe(401)
  })

  it('returns UI-shaped items as a plain array with total + next-cursor headers', async () => {
    const { app } = await setup({ rows: [section('a', { tags: ['module:D', 'project:p1'] })], total: 5 })
    const res = await app.inject({ method: 'GET', url: '/library?limit=1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-total-count']).toBe('5')
    expect(res.headers['x-next-cursor']).toBe('1')
    expect(res.json()[0]).toMatchObject({ id: 'a', module: 'D', itemType: 'section', pushedByName: 'Dr James Hartley', projectName: 'VELORA-301', isArchived: true })
  })

  it('leaves the next cursor empty on the last page and passes the offset through', async () => {
    const { app, findMany } = await setup({ rows: [section('a')], total: 3 })
    const res = await app.inject({ method: 'GET', url: '/library?limit=5&cursor=2' })
    expect(res.headers['x-next-cursor']).toBe('')
    expect(findMany.mock.calls[0]![0]).toMatchObject({ skip: 2, take: 5 })
  })

  it('translates filters to database conditions', async () => {
    const { app, count } = await setup()
    await app.inject({ method: 'GET', url: '/library?q=pfs&module=D,E&docType=NDA&ta=Oncology&projectId=p1&version=v2.0&from=2026-10-01&to=2026-10-31&itemType=section' })
    const where = lastWhere(count) as { isCurrent: boolean; retiredAt: null; AND: Array<Record<string, unknown>> }
    expect(where).toMatchObject({ isCurrent: true, retiredAt: null })
    const flat = JSON.stringify(where.AND)
    expect(flat).toContain('"contains":"pfs"')
    expect(flat).toContain('module:D')
    expect(flat).toContain('module:E')
    expect(flat).toContain('doctype:NDA')
    expect(flat).toContain('"taTag":{"in":["Oncology"]}')
    expect(flat).toContain('project:p1')
    expect(flat).toContain('"version":2')
    expect(flat).toContain('2026-10-01T00:00:00.000Z')
    expect(flat).toContain('2026-10-31T23:59:59.999Z')
    expect(flat).toContain('type:document')
  })

  it('takes an exact date-and-time range as well as whole days', async () => {
    const { app, count } = await setup()
    const res = await app.inject({ method: 'GET', url: `/library?from=${encodeURIComponent('2026-11-05T05:30:00.000Z')}&to=${encodeURIComponent('2026-11-05T18:29:59.999+05:30')}` })
    expect(res.statusCode).toBe(200)
    const flat = JSON.stringify(lastWhere(count).AND)
    expect(flat).toContain('2026-11-05T05:30:00.000Z')
    expect(flat).toContain('2026-11-05T12:59:59.999Z')   // the offset is honoured
  })

  it.each([
    ['recent',    [{ approvedAt: 'desc' }, { id: 'asc' }]],
    ['oldest',    [{ approvedAt: 'asc' }, { id: 'asc' }]],
    ['name-asc',  [{ title: 'asc' }, { id: 'asc' }]],
    ['name-desc', [{ title: 'desc' }, { id: 'asc' }]],
  ])('sorts by %s with an id tie-break', async (sort, orderBy) => {
    const { app, findMany } = await setup()
    await app.inject({ method: 'GET', url: `/library?sort=${sort}` })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ orderBy })
  })

  it('restricts non-super-admins to platform-wide + their own tenant', async () => {
    const { app, count } = await setup({ tenantId: 't1' })
    await app.inject({ method: 'GET', url: '/library' })
    expect(JSON.stringify(lastWhere(count).AND[0])).toBe('{"OR":[{"tenantId":null},{"tenantId":"t1"}]}')
  })

  it('lets super-admin see every tenant', async () => {
    const { app, count } = await setup({ role: 'admin' })
    await app.inject({ method: 'GET', url: '/library' })
    expect(lastWhere(count).AND[0]).toEqual({})
  })

  it.each(['sort=bogus', 'limit=0', 'limit=999', 'from=yesterday', 'from=2026-13-01', 'to=2026-02-30', 'cursor=abc', 'version=latest'])('rejects %s', async (qs) => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: `/library?${qs}` })).statusCode).toBe(400)
  })
})

describe('GET /library/projects', () => {
  it('lists the projects that have library items, for any signed-in role', async () => {
    const { app } = await setup({ role: 'contributor', rows: [section('a', { tags: ['project:p1', 'type:document'] }), section('b', { tags: ['project:p1', 'type:document'] }), section('c', { tags: ['module:A', 'type:document'] })] })
    const res = await app.inject({ method: 'GET', url: '/library/projects' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: 'p1', name: 'VELORA-301' }])
  })

  it('stays within the library\'s own visibility and lists whole documents only', async () => {
    const { app, findMany } = await setup({ tenantId: 't1', rows: [] })
    expect((await app.inject({ method: 'GET', url: '/library/projects' })).json()).toEqual([])
    const where = (findMany.mock.calls.at(-1)![0] as { where: { AND: unknown[] } }).where
    expect(JSON.stringify(where.AND)).toBe('[{"OR":[{"tenantId":null},{"tenantId":"t1"}]},{"category":{"not":"best_practice"},"tags":{"has":"type:document"}}]')
  })

  it('requires a signed-in user', async () => {
    const { app } = await setup({ role: null })
    expect((await app.inject({ method: 'GET', url: '/library/projects' })).statusCode).toBe(401)
  })
})

describe('GET /library/:id', () => {
  it('returns one item, or 404', async () => {
    const found = await setup({ rows: [section('a')] })
    expect((await found.app.inject({ method: 'GET', url: '/library/a' })).json()).toMatchObject({ id: 'a', name: 'Item a' })
    await current?.close()
    const missing = await setup({ rows: [] })
    current = missing.app
    expect((await missing.app.inject({ method: 'GET', url: '/library/nope' })).statusCode).toBe(404)
  })

  it('does not swallow the static /best-practices and /sections routes', async () => {
    const { app } = await setup({ rows: [] })
    expect((await app.inject({ method: 'GET', url: '/library/best-practices' })).json()).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/library/sections' })).statusCode).toBe(200)
  })
})

describe('best practices', () => {
  const body = {
    name: 'Module-D-CTD-Authoring-v1.2-2026-01', module: 'D', category: 'CTD Authoring', guidance: 'Use the data layer.',
    effectiveFrom: '2099-01-01', validUntil: '2099-12-31', applicableDocTypes: ['NDA'], frameworkRefs: ['ICH E3'],
  }

  it('lists best practices in the UI shape', async () => {
    const bp = section('bp1', { category: 'best_practice', title: body.name, tags: ['module:D', 'category:CTD Authoring', 'valid-until:2099-01-01'] })
    const { app, findMany } = await setup({ rows: [bp] })
    const res = (await app.inject({ method: 'GET', url: '/library/best-practices?module=D&category=CTD%20Authoring' })).json()
    expect(res[0]).toMatchObject({ id: 'bp1', module: 'D', category: 'CTD Authoring', name: body.name, reviewDue: false })
    expect(JSON.stringify(findMany.mock.calls[0]![0])).toContain('category:CTD Authoring')
  })

  it('creates one as super-admin, tagging it and writing an audit entry', async () => {
    const { app, create, append } = await setup({ role: 'admin' })
    const res = await app.inject({ method: 'POST', url: '/library/best-practices', payload: body })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({
      title: body.name, category: 'best_practice', taTag: 'Platform-wide', framework: 'ICH E3', version: 1, tenantId: null,
      tags: ['module:D', 'category:CTD Authoring', 'effective:2099-01-01', 'valid-until:2099-12-31', 'doctype:NDA'],
    })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'best_practice_created', entityType: 'library_section' }))
    expect(res.json()).toMatchObject({ name: body.name, module: 'D' })
  })

  it('is Platform Admin only — a tenant-scoped admin is forbidden', async () => {
    // Post 2026-10-27 role consolidation: 'super-admin' retired; the gate is
    // now role='admin' + tenantId=null (platform admin). A tenant-scoped
    // admin should still hit 403.
    const { app } = await setup({ role: 'admin', tenantId: 'TENANT-ACME' })
    expect((await app.inject({ method: 'POST', url: '/library/best-practices', payload: body })).statusCode).toBe(403)
  })

  it('rejects a bad name, a reversed date range and a duplicate', async () => {
    const { app } = await setup({ role: 'admin' })
    const post = (p: object) => app.inject({ method: 'POST', url: '/library/best-practices', payload: p })
    const badName = await post({ ...body, name: 'my best practice' })
    expect(badName.statusCode).toBe(400)
    expect(badName.json().message).toContain('[Module]-[Category]-[Version]-[Date]')
    expect((await post({ ...body, validUntil: '2025-01-01' })).statusCode).toBe(400)
    expect((await post({ ...body, effectiveFrom: '2025-01-01' })).statusCode).toBe(422)
    await current?.close()
    const dup = await setup({ role: 'admin', dup: true })
    expect((await dup.app.inject({ method: 'POST', url: '/library/best-practices', payload: body })).statusCode).toBe(409)
  })

  it('rejects an inactive therapeutic area', async () => {
    const { app } = await setup({ role: 'admin', ta: null })
    const res = await app.inject({ method: 'POST', url: '/library/best-practices', payload: { ...body, therapeuticArea: 'Nope' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_therapeutic_area')
  })
})

describe('GET /library/enabled-modules', () => {
  it('requires a signed-in user', async () => {
    const { app } = await setup({ role: null })
    expect((await app.inject({ method: 'GET', url: '/library/enabled-modules' })).statusCode).toBe(401)
  })

  it("returns only the writing modules the caller's tenant has switched on", async () => {
    const { app } = await setup({ tenantId: 't1', tenantModules: ['A', 'C'] })
    const res = await app.inject({ method: 'GET', url: '/library/enabled-modules' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ modules: ['A', 'C'] })
  })

  it('a platform user with no tenant gets every module the deployment has on', async () => {
    const { app } = await setup({ tenantId: null })
    const res = await app.inject({ method: 'GET', url: '/library/enabled-modules' })
    expect(res.json().modules).toEqual(expect.arrayContaining(['A']))
  })

  it('is not read as a library item id', async () => {
    const { app } = await setup({ tenantId: 't1', tenantModules: ['B'] })
    expect((await app.inject({ method: 'GET', url: '/library/enabled-modules' })).json()).toEqual({ modules: ['B'] })
  })
})

describe('GET /library — lean list rows, scoped context, comma-safe filters', () => {
  it('leaves the document text out of list rows, and GET /library/:id still returns it', async () => {
    const { app } = await setup({ rows: [section('a', { body: 'The full text of a very long document' })] })
    const list = (await app.inject({ method: 'GET', url: '/library' })).json()
    expect(list[0]).toMatchObject({ id: 'a', name: 'Item a' })
    expect(list[0]).not.toHaveProperty('body')
    const one = (await app.inject({ method: 'GET', url: '/library/a' })).json()
    expect(one.body).toBe('The full text of a very long document')
  })

  it("looks up first versions only among the tenants of the rows on the page, never other tenants' rows", async () => {
    const { app, findMany } = await setup({ tenantId: 't1', rows: [section('a', { tenantId: 't1' })] })
    await app.inject({ method: 'GET', url: '/library' })
    // call 0 = the page itself, call 1 = fetchContext's title look-up
    const lookup = (findMany.mock.calls[1]![0] as { where: { title: unknown; AND: unknown[] } }).where
    expect(JSON.stringify(lookup.AND)).toBe('[{"OR":[{"tenantId":{"in":["t1"]}}]}]')
  })

  it('includes platform-wide rows (tenantId null) in that look-up only when the page has such rows', async () => {
    const { app, findMany } = await setup({ rows: [section('a', { tenantId: null }), section('b', { tenantId: 't2' })] })
    await app.inject({ method: 'GET', url: '/library' })
    const lookup = (findMany.mock.calls[1]![0] as { where: { AND: unknown[] } }).where
    expect(JSON.stringify(lookup.AND)).toBe('[{"OR":[{"tenantId":null},{"tenantId":{"in":["t2"]}}]}]')
  })

  it('keeps a comma inside a filter value: "Blog,Post" sent percent-encoded stays one doc type', async () => {
    const { app, findMany } = await setup({ rows: [] })
    // the web app encodes "," as %2C and "%" as %25 inside the value; the URL then carries it encoded once more
    const res = await app.inject({ method: 'GET', url: '/library?docType=Blog%252CPost,CSR' })
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify((findMany.mock.calls[0]![0] as { where: unknown }).where)).toContain('"hasSome":["doctype:Blog,Post","doctype:CSR"]')
  })

  it('still reads a plain list value exactly as before', async () => {
    const { app, findMany } = await setup({ rows: [] })
    await app.inject({ method: 'GET', url: '/library?docType=NDA,CSR' })
    expect(JSON.stringify((findMany.mock.calls[0]![0] as { where: unknown }).where)).toContain('"hasSome":["doctype:NDA","doctype:CSR"]')
  })
})

describe('GET /library/count and the lean list query', () => {
  it('counts with the same filters as the list and does no other work', async () => {
    const { app, findMany, count } = await setup({ rows: [section('a')], total: 7 })
    const res = await app.inject({ method: 'GET', url: '/library/count?itemType=document&docType=CSR' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 7 })
    expect(findMany).not.toHaveBeenCalled()                       // no rows, no names/projects/signatures look-ups
    const where = JSON.stringify((count.mock.calls[0]![0] as { where: unknown }).where)
    expect(where).toContain('"type:document"')
    expect(where).toContain('"doctype:CSR"')
  })

  it('count and list build the same WHERE', async () => {
    const q = '?itemType=document&module=A&ta=Oncology&q=synopsis'
    const one = await setup({ rows: [section('a')], total: 1 })
    await one.app.inject({ method: 'GET', url: '/library/count' + q })
    const countWhere = JSON.stringify((one.count.mock.calls[0]![0] as { where: unknown }).where)
    await current?.close()
    const two = await setup({ rows: [section('a')], total: 1 })
    await two.app.inject({ method: 'GET', url: '/library' + q })
    expect(JSON.stringify((two.findMany.mock.calls[0]![0] as { where: unknown }).where)).toBe(countWhere)
  })

  it('rejects a bad version the same way on both routes', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/library/count?version=banana' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/library?version=banana' })).statusCode).toBe(400)
  })

  it('requires a signed-in user', async () => {
    const { app } = await setup({ role: null })
    expect((await app.inject({ method: 'GET', url: '/library/count' })).statusCode).toBe(401)
  })

  it('the list reads every column except the text', async () => {
    const { app, findMany } = await setup({ rows: [section('a')] })
    await app.inject({ method: 'GET', url: '/library' })
    const select = (findMany.mock.calls[0]![0] as { select: Record<string, boolean> }).select
    expect(select.title).toBe(true)
    expect(select.tags).toBe(true)
    expect(select).not.toHaveProperty('body')
  })

  it('searches the document text only from 3 characters; shorter terms look at title and tags', async () => {
    const short = await setup({ rows: [] })
    await short.app.inject({ method: 'GET', url: '/library?q=ab' })
    const shortWhere = JSON.stringify((short.findMany.mock.calls[0]![0] as { where: unknown }).where)
    expect(shortWhere).toContain('"title":{"contains":"ab"')
    expect(shortWhere).not.toContain('"body"')
    await current?.close()

    const long = await setup({ rows: [] })
    await long.app.inject({ method: 'GET', url: '/library?q=abc' })
    const longWhere = JSON.stringify((long.findMany.mock.calls[0]![0] as { where: unknown }).where)
    expect(longWhere).toContain('"body":{"contains":"abc"')
  })
})
