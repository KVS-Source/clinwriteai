// GET /projects — each row carries a real (non-deleted) document count,
// broken down per module for the Documents column's colour chips.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

describe('GET /projects documentCount', () => {
  it('adds the grouped document count per project, 0 when none', async () => {
    const groupBy = vi.fn(async () => [{ projectId: 'p1', _count: { _all: 5 } }])
    const empty = vi.fn(async () => [] as Array<{ projectId: string; _count: { _all: number } }>)
    const app = Fastify()
    app.decorate('prisma', {
      project: { findMany: vi.fn(async () => [
        { id: 'p1', name: 'One', teamMembers: [] },
        { id: 'p2', name: 'Two', teamMembers: [] },
      ]) },
      document:             { groupBy },
      publication:          { groupBy: empty },
      medContentItem:       { groupBy: empty },
      regulatorySubmission: { groupBy: empty },
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
    const body = res.json() as Array<{ id: string; documentCount: number; documentCountByModule: Record<string, number> }>
    // Total documentCount = sum of per-module counts; only Module A has
    // data in this fixture so clinicalWriting=5 and the others are 0.
    expect(body.map(p => [p.id, p.documentCount])).toEqual([['p1', 5], ['p2', 0]])
    expect(body[0]!.documentCountByModule).toEqual({
      clinicalWriting:    5,
      scientificWriting:  0,
      medicalWriting:     0,
      regulatoryWriting:  0,
      ideationPublishing: 0,
    })
    expect(body[1]!.documentCountByModule).toEqual({
      clinicalWriting:    0,
      scientificWriting:  0,
      medicalWriting:     0,
      regulatoryWriting:  0,
      ideationPublishing: 0,
    })
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }))
  })

  it('sums per-module counts into documentCount when multiple modules have docs', async () => {
    const cwBy = vi.fn(async () => [{ projectId: 'p1', _count: { _all: 4 } }])
    const swBy = vi.fn(async () => [{ projectId: 'p1', _count: { _all: 2 } }])
    const mwBy = vi.fn(async () => [{ projectId: 'p1', _count: { _all: 1 } }])
    const rwBy = vi.fn(async () => [] as Array<{ projectId: string; _count: { _all: number } }>)
    const app = Fastify()
    app.decorate('prisma', {
      project: { findMany: vi.fn(async () => [{ id: 'p1', name: 'One', teamMembers: [] }]) },
      document:             { groupBy: cwBy },
      publication:          { groupBy: swBy },
      medContentItem:       { groupBy: mwBy },
      regulatorySubmission: { groupBy: rwBy },
    } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => {
      const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'admin', modules: ['A', 'B', 'C', 'D'], tenantId: null }
      Object.assign(r, { user })
    })
    await app.register(projectRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/' })
    const body = res.json() as Array<{ documentCount: number; documentCountByModule: Record<string, number> }>
    expect(body[0]!.documentCount).toBe(4 + 2 + 1 + 0)
    expect(body[0]!.documentCountByModule).toMatchObject({
      clinicalWriting:   4,
      scientificWriting: 2,
      medicalWriting:    1,
      regulatoryWriting: 0,
    })
  })
})
