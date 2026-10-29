// GET /projects/:projectId/comments — all comments on a project's live documents in one call.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { projectCommentsRoutes } from './routes.js'

async function build(opts: { project?: boolean; docs?: string[] } = {}) {
  const docFindMany = vi.fn(async () => (opts.docs ?? ['d1', 'd2']).map(id => ({ id })))
  const commentFindMany = vi.fn(async () => [
    { id: 'CMT-002', documentId: 'd2', reviewerId: 'u1', status: 'open', createdAt: new Date('2026-10-02T00:00:00Z') },
    { id: 'CMT-001', documentId: 'd1', reviewerId: 'u1', status: 'resolved', resolvedBy: 'u2', createdAt: new Date('2026-10-01T00:00:00Z') },
  ])
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => (opts.project === false ? null : { id: 'p1' })) },
    document: { findMany: docFindMany },
    comment: { findMany: commentFindMany },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'Ann Lee', initials: 'AL' }, { id: 'u2', name: 'Bo Chen', initials: 'BC' }]) },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'admin', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(projectCommentsRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, docFindMany, commentFindMany }
}

describe('GET /projects/:projectId/comments', () => {
  it('returns every comment of the project’s live documents, each with its documentId and names', async () => {
    const { app, docFindMany, commentFindMany } = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/p1/comments' })
    expect(res.statusCode).toBe(200)
    const rows = res.json()
    expect(rows.map((r: { id: string; documentId: string }) => [r.id, r.documentId])).toEqual([['CMT-002', 'd2'], ['CMT-001', 'd1']])
    expect(rows[0].reviewerName).toBe('Ann Lee')
    expect(docFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p1', deletedAt: null } }))
    expect(commentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId: { in: ['d1', 'd2'] } } }))
    await app.close()
  })

  it('404s an unknown project and returns [] for a project without documents', async () => {
    const missing = await build({ project: false })
    expect((await missing.app.inject({ method: 'GET', url: '/projects/nope/comments' })).statusCode).toBe(404)
    await missing.app.close()
    const empty = await build({ docs: [] })
    const res = await empty.app.inject({ method: 'GET', url: '/projects/p1/comments' })
    expect(res.json()).toEqual([])
    expect(empty.commentFindMany).not.toHaveBeenCalled()
    await empty.app.close()
  })
})
