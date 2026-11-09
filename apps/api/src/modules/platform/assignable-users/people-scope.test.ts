// GET /projects/:id/assignable-users?scope=people — names for showing who did what, so screens don't need
// the admin-only user directory: everyone on the project whatever their status or role, without emails or
// capabilities, and only for someone who can see the project.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { assignableUsersRoutes } from './routes.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const USERS: Row[] = [
  { id: 'u-member', name: 'Mia Member', initials: 'MM', status: 'active', email: 'm@x.io', capabilities: ['can-author'], modules: [], tenantId: 'T1', role: 'contributor' },
  { id: 'u-gone', name: 'Sam Suspended', initials: 'SS', status: 'suspended', email: 's@x.io', capabilities: [], modules: ['A'], tenantId: 'T1', role: 'contributor' },
  { id: 'u-left', name: 'Dee Deprovisioned', initials: 'DD', status: 'deprovisioned', email: 'd@x.io', capabilities: [], modules: [], tenantId: 'T1', role: 'contributor' },
  { id: 'u-owner', name: 'Ann Assignee', initials: 'AA', status: 'active', email: 'a@x.io', capabilities: [], modules: [], tenantId: 'T1', role: 'contributor' },
  { id: 'u-admin', name: 'Tess Admin', initials: 'TA', status: 'active', email: 't@x.io', capabilities: [], modules: ['A'], tenantId: 'T1', role: 'tenant-admin' },
  { id: 'u-other', name: 'Otto Other', initials: 'OO', status: 'active', email: 'o@x.io', capabilities: [], modules: ['A'], tenantId: 'T2', role: 'contributor' },
]

async function build(actor: Partial<AuthenticatedUser>, opts: { memberOf?: string[] } = {}) {
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'p1', tenantId: 'T1' })) },
    projectMember: {
      findMany: vi.fn(async ({ where }: Row) => (where.projectId
        ? [{ userId: 'u-member', projectRole: 'Writer' }]                                // the project's members
        : (opts.memberOf ?? []).map(projectId => ({ projectId })))),                     // the caller's projects
    },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    documentRaci: { findMany: vi.fn(async () => [{ userId: 'u-left' }]) },               // left, but still holds a letter
    document: { findMany: vi.fn(async ({ where }: Row) => (where.projectId ? [{ assigneeId: 'u-owner' }, { assigneeId: null }] : [])) },
    user: {
      findMany: vi.fn(async ({ where }: Row) => USERS.filter(u => (where.OR as Row[]).some(c => {
        if (c.id) return c.id.in.includes(u.id)
        return u.modules.includes(c.modules.has) && (c.OR as Row[]).some(t => t.tenantId === u.tenantId)
      })).map(({ id, name, initials, status }) => ({ id, name, initials, status }))),
    },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    Object.assign(r, { user: { id: 'me', email: 'm@x', role: 'pm', modules: ['A'], tenantId: 'T1', ...actor } })
  })
  await app.register(assignableUsersRoutes, { prefix: '/projects' })
  await app.ready()
  return app
}

const people = (app: Awaited<ReturnType<typeof build>>) => app.inject({ url: '/projects/p1/assignable-users?scope=people' })

describe('scope=people', () => {
  it('a PM on the project gets everyone on it, whatever their status or role', async () => {
    const app = await build({ role: 'pm' }, { memberOf: ['p1'] })
    const res = await people(app)
    expect(res.statusCode).toBe(200)
    const ids = (res.json() as Row[]).map(p => p.id).sort()
    expect(ids).toEqual(['u-admin', 'u-gone', 'u-left', 'u-member', 'u-owner'])     // not the other tenant's user
    await app.close()
  })

  it('returns only what a name needs: no email or capabilities', async () => {
    const app = await build({ role: 'contributor' }, { memberOf: ['p1'] })
    const row = (await people(app)).json<Row[]>().find(p => p.id === 'u-gone')!
    expect(row).toEqual({ id: 'u-gone', name: 'Sam Suspended', initials: 'SS', status: 'suspended' })
    await app.close()
  })

  it('is refused (404) for someone who can’t see the project', async () => {
    const app = await build({ role: 'contributor' }, { memberOf: ['p-other'] })
    expect((await people(app)).statusCode).toBe(404)
    await app.close()
  })

  it.each(['tenant-admin', 'auditor'])('a %s, who sees every project, gets the list', async (role) => {
    const app = await build({ role: role as AuthenticatedUser['role'] })
    expect((await people(app)).statusCode).toBe(200)
    await app.close()
  })
})
