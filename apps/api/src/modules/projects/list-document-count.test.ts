// GET /projects — each row carries a real (non-deleted) document count.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

describe('GET /projects documentCount', () => {
  it('adds the grouped document count per project, 0 when none', async () => {
    const groupBy = vi.fn(async () => [{ projectId: 'p1', _count: { _all: 5 } }])
    const app = Fastify()
    app.decorate('prisma', {
      project: { findMany: vi.fn(async () => [
        { id: 'p1', name: 'One', teamMembers: [] },
        { id: 'p2', name: 'Two', teamMembers: [] },
      ]) },
      document: { groupBy },
    } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => {
      const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'admin', modules: ['A'], tenantId: null }
      Object.assign(r, { user })
    })
    await app.register(projectRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: { id: string; documentCount: number }) => [p.id, p.documentCount])).toEqual([['p1', 5], ['p2', 0]])
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }))
  })
})
