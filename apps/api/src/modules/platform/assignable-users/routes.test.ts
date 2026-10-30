// GET /projects/:projectId/assignable-users — candidates for the RACI picker and the New Document assignee.
// Project members plus active module-A users of the project's tenant (untenanted users included), filtered by capability.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { assignableUsersRoutes } from './routes.js'

type U = { id: string; name: string; email: string; initials: string | null; capabilities: string[]; modules: string[]; status: string; role: string; tenantId: string | null }
const u = (id: string, over: Partial<U> = {}): U => ({
  id, name: id, email: `${id}@x.io`, initials: null, capabilities: ['can-author'], modules: ['A'], status: 'active', role: 'contributor', tenantId: 'T1', ...over,
})

type Where = { status: string | { in: string[] }; role?: { notIn: string[] }; OR: Array<Record<string, unknown>> }

async function build(users: U[], members: Array<{ userId: string; projectRole: string | null }> = [], projectTenant: string | null = 'T1') {
  // A tiny in-memory evaluation of the where clause the route builds.
  const findMany = vi.fn(async ({ where }: { where: Where }) =>
    users.filter(x => {
      if (typeof where.status === 'string' ? x.status !== where.status : !where.status.in.includes(x.status)) return false
      if (where.role && where.role.notIn.includes(x.role)) return false
      return where.OR.some(clause => {
        if ('id' in clause) return ((clause.id as { in: string[] }).in).includes(x.id)
        if (!(clause.modules as { has: string }).has || !x.modules.includes((clause.modules as { has: string }).has)) return false
        const tenantOr = clause.OR as Array<{ tenantId: string | null }> | undefined
        return !tenantOr || tenantOr.some(t => t.tenantId === x.tenantId)
      })
    }))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'p1', tenantId: projectTenant })) },
    projectMember: { findMany: vi.fn(async () => members) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    user: { findMany },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'me', email: 'm@x', role: 'contributor', modules: ['A'], tenantId: 'T1' }
    Object.assign(r, { user })
  })
  await app.register(assignableUsersRoutes, { prefix: '/projects' })
  await app.ready()
  return app
}

const names = async (app: Awaited<ReturnType<typeof build>>, qs = '') =>
  ((await app.inject({ method: 'GET', url: `/projects/p1/assignable-users${qs}` })).json() as Array<{ id: string }>).map(x => x.id).sort()

describe('assignable users', () => {
  it('lists module-A users of the tenant even when the project has no members, and untenanted ones', async () => {
    const app = await build([u('ravi', { tenantId: null }), u('ananya'), u('other-tenant', { tenantId: 'T2' }), u('module-b-only', { modules: ['B'] })])
    expect(await names(app)).toEqual(['ananya', 'ravi'])
    await app.close()
  })

  it('keeps project members whatever their module, and reports their project role', async () => {
    const app = await build([u('member', { modules: ['B'], tenantId: 'T2' })], [{ userId: 'member', projectRole: 'Clinical Writer' }])
    const res = (await app.inject({ method: 'GET', url: '/projects/p1/assignable-users' })).json() as Array<{ id: string; projectRole: string | null }>
    expect(res).toMatchObject([{ id: 'member', projectRole: 'Clinical Writer' }])
    await app.close()
  })

  it('leaves out inactive users and applies the capability filter', async () => {
    const app = await build([u('author'), u('reviewer', { capabilities: ['can-review'] }), u('invited', { status: 'invited' })])
    expect(await names(app)).toEqual(['author', 'reviewer'])
    expect(await names(app, '?capability=can-review')).toEqual(['reviewer'])
    await app.close()
  })

  it('scope=raci: every active or invited non-admin, ignoring capabilities', async () => {
    const app = await build([
      u('author'), u('no-caps', { capabilities: [] }), u('invited', { status: 'invited', capabilities: [] }),
      u('admin', { role: 'tenant-admin' }), u('gone', { status: 'deprovisioned' }), u('paused', { status: 'suspended' }),
    ])
    expect(await names(app, '?scope=raci')).toEqual(['author', 'invited', 'no-caps'])
    expect(await names(app, '?scope=raci&capability=can-approve')).toEqual(['author', 'invited', 'no-caps'])
    await app.close()
  })

  it('does not filter by tenant when the project has none', async () => {
    const app = await build([u('a', { tenantId: 'T9' })], [], null)
    expect(await names(app)).toEqual(['a'])
    await app.close()
  })
})
