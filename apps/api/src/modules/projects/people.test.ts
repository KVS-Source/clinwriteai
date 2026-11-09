// GET /projects/:id/people — everyone on the project, each counted once.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

async function build(role = 'admin') {
  const accounts = ['u-pm', 'u-member', 'u-team', 'u-assignee', 'u-creator', 'u-raci', 'u-raci2']   // real accounts
  const userFindMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter(id => accounts.includes(id)).map(id => ({ id })))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
    projectMember: { findMany: vi.fn(async () => [{ userId: 'u-pm' }, { userId: 'u-member' }]) },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => [{ userId: 'u-team' }, { userId: 'user-PLACEHOLDER' }, { userId: 'u-member' }]) },
    document: { findMany: vi.fn(async () => [
      { assigneeId: 'u-assignee', createdBy: 'u-creator' },
      { assigneeId: 'u-assignee', createdBy: 'u-pm' },
    ]) },
    documentRaci: { findMany: vi.fn(async () => [{ userId: 'u-raci' }, { userId: 'u-raci2' }, { userId: 'u-raci' }, { userId: 'u-member' }]) },
    user: { findMany: userFindMany },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'u-x', email: 'e@v', role: role as AuthenticatedUser['role'], modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(projectRoutes)
  await app.ready()
  return { app, userFindMany }
}

describe('GET /:id/people', () => {
  it('counts members (PMs included), the roster, RACI holders, assignees and creators once each', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/p1/people' })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(7)
    expect(res.json().userIds.sort()).toEqual(['u-assignee', 'u-creator', 'u-member', 'u-pm', 'u-raci', 'u-raci2', 'u-team'])
  })

  it('leaves out roster placeholders that have no account, and asks only for people who are not deprovisioned', async () => {
    const { app, userFindMany } = await build()
    const res = await app.inject({ method: 'GET', url: '/p1/people' })
    expect(res.json().userIds).not.toContain('user-PLACEHOLDER')
    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: 'deprovisioned' } }) }))
  })

  it('is hidden (404) from someone who cannot see the project', async () => {
    const { app } = await build('contributor')
    const res = await app.inject({ method: 'GET', url: '/p1/people' })
    expect(res.statusCode).toBe(404)
  })
})
