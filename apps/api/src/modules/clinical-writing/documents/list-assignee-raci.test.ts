// GET /projects/:projectId/documents carries the assignee's RACI letters per document ("Assigned To" column).

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

const doc = (id: string, assigneeId: string | null) => ({
  id, projectId: 'p1', type: 'csr_full', title: id, status: 'in_authoring', stage: 'study_start_up',
  assigneeId, deletedAt: null, updatedAt: new Date('2026-10-30T10:00:00Z'), currentVersion: { versionNumber: 'v0.1' },
})

async function build(raci: Array<{ documentId: string; userId: string; letter: string }>) {
  const raciFind = vi.fn(async () => raci)
  const app = Fastify()
  app.decorate('prisma', {
    project:  { findUnique: vi.fn(async () => ({ id: 'p1' })) },
    document: { findMany: vi.fn(async () => [doc('d1', 'u1'), doc('d2', 'u2'), doc('d3', null)]) },
    user:     { findMany: vi.fn(async () => [{ id: 'u1', name: 'Elena', initials: 'EV' }, { id: 'u2', name: 'Ravi', initials: 'RA' }]) },
    documentRaci: { findMany: raciFind },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'admin', email: 'a@x', role: 'admin', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, raciFind }
}

describe('GET /projects/:projectId/documents assigneeRaci', () => {
  it("lists only the assignee's own letters, in R-A-C-I order, and [] when none or unassigned", async () => {
    const { app, raciFind } = await build([
      { documentId: 'd1', userId: 'u1', letter: 'C' },
      { documentId: 'd1', userId: 'u1', letter: 'R' },
      { documentId: 'd1', userId: 'someone-else', letter: 'A' },   // not the assignee
      { documentId: 'd2', userId: 'u1', letter: 'R' },             // u1 is not d2's assignee
    ])
    const res = await app.inject({ method: 'GET', url: '/projects/p1/documents' })
    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries((res.json() as Array<{ id: string; assigneeRaci: string[] }>).map(d => [d.id, d.assigneeRaci]))
    expect(byId).toEqual({ d1: ['R', 'C'], d2: [], d3: [] })
    // only active, whole-document rows count
    expect(raciFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ removedAt: null, sectionId: null }) }))
    await app.close()
  })
})
