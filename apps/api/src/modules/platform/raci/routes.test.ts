// RACI routes — exercised through Fastify inject() against a fake Prisma + audit,
// so no database is touched. Pins the "every referenced user must exist" check on PUT.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { raciRoutes } from './routes.js'

const KNOWN_USERS = ['user-a', 'user-b', 'user-c']

async function buildApp() {
  const upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'row-1', ...create }))
  const findManyUsers = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter(id => KNOWN_USERS.includes(id)).map(id => ({ id })))
  const append = vi.fn(async () => undefined)

  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'proj-1' ? { id: 'proj-1' } : null)) },
    user: { findMany: findManyUsers },
    raciAssignment: { upsert },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: 'user-admin', email: 'admin@clinwrite.ai', role: 'admin', modules: [], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(raciRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, upsert, findManyUsers }
}

let current: FastifyInstance | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

async function put(body: unknown, projectId = 'proj-1') {
  const built = await buildApp()
  current = built.app
  const res = await built.app.inject({ method: 'PUT', url: `/projects/${projectId}/raci`, payload: body as never })
  return { res, ...built }
}

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
