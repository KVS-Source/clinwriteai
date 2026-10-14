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

interface Setup { role?: Role | null; tenantId?: string | null; rows?: SectionRow[]; total?: number; ta?: string | null; dup?: boolean }

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
    const { app, count } = await setup({ role: 'super-admin' })
    await app.inject({ method: 'GET', url: '/library' })
    expect(lastWhere(count).AND[0]).toEqual({})
  })

  it.each(['sort=bogus', 'limit=0', 'limit=999', 'from=yesterday', 'cursor=abc', 'version=latest'])('rejects %s', async (qs) => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: `/library?${qs}` })).statusCode).toBe(400)
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
    effectiveFrom: '2026-01-01', validUntil: '2026-12-31', applicableDocTypes: ['NDA'], frameworkRefs: ['ICH E3'],
  }

  it('lists best practices in the UI shape', async () => {
    const bp = section('bp1', { category: 'best_practice', title: body.name, tags: ['module:D', 'category:CTD Authoring', 'valid-until:2099-01-01'] })
    const { app, findMany } = await setup({ rows: [bp] })
    const res = (await app.inject({ method: 'GET', url: '/library/best-practices?module=D&category=CTD%20Authoring' })).json()
    expect(res[0]).toMatchObject({ id: 'bp1', module: 'D', category: 'CTD Authoring', name: body.name, reviewDue: false })
    expect(JSON.stringify(findMany.mock.calls[0]![0])).toContain('category:CTD Authoring')
  })

  it('creates one as super-admin, tagging it and writing an audit entry', async () => {
    const { app, create, append } = await setup({ role: 'super-admin' })
    const res = await app.inject({ method: 'POST', url: '/library/best-practices', payload: body })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({
      title: body.name, category: 'best_practice', taTag: 'Platform-wide', framework: 'ICH E3', version: 1, tenantId: null,
      tags: ['module:D', 'category:CTD Authoring', 'effective:2026-01-01', 'valid-until:2026-12-31', 'doctype:NDA'],
    })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'best_practice_created', entityType: 'library_section' }))
    expect(res.json()).toMatchObject({ name: body.name, module: 'D' })
  })

  it('is Super Admin only', async () => {
    const { app } = await setup({ role: 'admin' })
    expect((await app.inject({ method: 'POST', url: '/library/best-practices', payload: body })).statusCode).toBe(403)
  })

  it('rejects a bad name, a reversed date range and a duplicate', async () => {
    const { app } = await setup({ role: 'super-admin' })
    const post = (p: object) => app.inject({ method: 'POST', url: '/library/best-practices', payload: p })
    const badName = await post({ ...body, name: 'my best practice' })
    expect(badName.statusCode).toBe(400)
    expect(badName.json().message).toContain('[Module]-[Category]-[Version]-[Date]')
    expect((await post({ ...body, validUntil: '2025-01-01' })).statusCode).toBe(400)
    await current?.close()
    const dup = await setup({ role: 'super-admin', dup: true })
    expect((await dup.app.inject({ method: 'POST', url: '/library/best-practices', payload: body })).statusCode).toBe(409)
  })

  it('rejects an inactive therapeutic area', async () => {
    const { app } = await setup({ role: 'super-admin', ta: null })
    const res = await app.inject({ method: 'POST', url: '/library/best-practices', payload: { ...body, therapeuticArea: 'Nope' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_therapeutic_area')
  })
})
