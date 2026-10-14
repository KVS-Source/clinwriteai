// RACI routes — exercised through Fastify inject() against a fake Prisma + audit,
// so no database is touched. Pins the "every referenced user must exist" check on PUT.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { raciRoutes } from './routes.js'

const KNOWN_USERS = ['user-a', 'user-b', 'user-c']

const SAVED_AT = new Date('2026-10-13T09:00:00.000Z')

// A row another admin saved earlier — what a later PUT overwrites / DELETE removes.
const EXISTING_ROW = {
  id: 'row-1', projectId: 'proj-1', activity: 'A:a-t1',
  responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: ['user-a'],
  notes: null, updatedBy: 'user-other-admin', updatedAt: SAVED_AT, createdAt: SAVED_AT,
}

async function buildApp(existing: typeof EXISTING_ROW | null = null) {
  const upsert = vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
    existing
      ? { ...existing, ...update, updatedAt: new Date('2026-10-13T10:00:00.000Z') }
      : { id: 'row-1', ...create, updatedAt: new Date('2026-10-13T10:00:00.000Z') })
  const findUniqueRow = vi.fn(async () => existing)
  const deleteRow = vi.fn(async () => existing)
  const findManyUsers = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter(id => KNOWN_USERS.includes(id)).map(id => ({ id })))
  const append = vi.fn(async (_event: { action: string; details: Record<string, unknown> }) => undefined)

  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'proj-1' ? { id: 'proj-1' } : null)) },
    user: { findMany: findManyUsers },
    raciAssignment: { upsert, findUnique: findUniqueRow, delete: deleteRow },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: 'user-admin', email: 'admin@clinwrite.ai', role: 'admin', modules: [], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(raciRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, upsert, findManyUsers, append, deleteRow }
}

let current: FastifyInstance | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

async function put(body: unknown, projectId = 'proj-1', existing: typeof EXISTING_ROW | null = null) {
  const built = await buildApp(existing)
  current = built.app
  const res = await built.app.inject({ method: 'PUT', url: `/projects/${projectId}/raci`, payload: body as never })
  return { res, ...built }
}

async function del(activity: string, existing: typeof EXISTING_ROW | null) {
  const built = await buildApp(existing)
  current = built.app
  const res = await built.app.inject({ method: 'DELETE', url: `/projects/proj-1/raci/${encodeURIComponent(activity)}` })
  return { res, ...built }
}

// Audit details must survive a JSONB round-trip unchanged, or the hash chain breaks on verify.
const jsonRoundTrip = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('RACI audit trail — last write wins, every version recoverable', () => {
  it('first save records created=true, before=null and the full after state (incl. C and I)', async () => {
    const { res, append } = await put({
      activity: 'A:a-t1', responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: ['user-a'],
    })
    expect(res.statusCode).toBe(200)
    expect(append).toHaveBeenCalledOnce()
    const event = append.mock.calls[0]![0]
    expect(event.action).toBe('raci_assignment_set')
    expect(event.details).toMatchObject({
      projectId: 'proj-1', activity: 'A:a-t1', created: true, before: null,
      after: { responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: ['user-a'], updatedBy: 'user-admin' },
    })
    expect(jsonRoundTrip(event.details)).toEqual(event.details)
  })

  it("overwriting another admin's row records their version as `before`", async () => {
    const { res, append } = await put(
      { activity: 'A:a-t1', responsibleId: 'user-c', accountableId: 'user-a', consultedIds: [], informedIds: ['user-b'] },
      'proj-1',
      EXISTING_ROW,
    )
    expect(res.statusCode).toBe(200)
    const event = append.mock.calls[0]![0]
    expect(event.details).toMatchObject({
      created: false,
      before: {
        responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: ['user-a'],
        updatedBy: 'user-other-admin', updatedAt: SAVED_AT.toISOString(),
      },
      after: { responsibleId: 'user-c', accountableId: 'user-a', consultedIds: [], informedIds: ['user-b'], updatedBy: 'user-admin' },
    })
    expect(jsonRoundTrip(event.details)).toEqual(event.details)
  })

  it('reset (DELETE) records the full row that was removed', async () => {
    const { res, append, deleteRow } = await del('A:a-t1', EXISTING_ROW)
    expect(res.statusCode).toBe(204)
    expect(deleteRow).toHaveBeenCalledOnce()
    const event = append.mock.calls[0]![0]
    expect(event.action).toBe('raci_assignment_deleted')
    expect(event.details).toEqual({
      projectId: 'proj-1', activity: 'A:a-t1',
      before: {
        responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: ['user-a'],
        notes: null, updatedBy: 'user-other-admin', updatedAt: SAVED_AT.toISOString(),
      },
    })
  })

  it('does not audit a rejected save', async () => {
    const { res, append } = await put({ activity: 'A:a-t1', accountableId: 'ghost-1' })
    expect(res.statusCode).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })
})

describe('PUT /projects/:projectId/raci — user validation', () => {
  it('saves when every referenced user exists', async () => {
    const { res, upsert } = await put({
      activity: 'A:a-t1', responsibleId: 'user-a', accountableId: 'user-b', consultedIds: ['user-c'], informedIds: [],
    })
    expect(res.statusCode).toBe(200)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it('rejects with 400 unknown_user and lists the missing ids, without saving', async () => {
    const { res, upsert } = await put({
      activity: 'A:a-t1', responsibleId: 'ghost-1', accountableId: 'user-b', consultedIds: ['user-c', 'ghost-2'], informedIds: ['ghost-1'],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'unknown_user', userIds: ['ghost-1', 'ghost-2'] })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('skips the user lookup when nobody is referenced', async () => {
    const { res, findManyUsers } = await put({ activity: 'A:a-t1', consultedIds: [], informedIds: [] })
    expect(res.statusCode).toBe(200)
    expect(findManyUsers).not.toHaveBeenCalled()
  })

  it('still returns 404 for an unknown project before checking users', async () => {
    const { res, findManyUsers } = await put({ activity: 'A:a-t1', accountableId: 'ghost-1' }, 'proj-missing')
    expect(res.statusCode).toBe(404)
    expect(findManyUsers).not.toHaveBeenCalled()
  })
})
