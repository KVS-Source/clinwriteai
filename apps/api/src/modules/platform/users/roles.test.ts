// User Management roles: POST /admin/users/:id/roles adds a role alongside the current one, DELETE
// /admin/users/:id/roles/:role revokes one. At most 2, only the allowed pairs, never the last role,
// active users only, every change audited.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { userRoutes } from './routes.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const ADMIN: AuthenticatedUser = { id: 'u-admin', email: 'a@x.io', role: 'tenant-admin', capabilities: [], modules: ['A'], tenantId: 't-1' }

async function build(target: Row) {
  const user = { id: 'u-1', email: 'p@x.io', name: 'Pat', role: 'pm', additionalRoles: [], capabilities: [], modules: ['A'], status: 'active', tenantId: 't-1', ...target }
  const audit: Row[] = []
  const update = vi.fn(async ({ data }: Row) => ({ ...Object.assign(user, data) }))
  const app = Fastify()
  app.decorate('prisma', {
    user: { findFirst: vi.fn(async ({ where }: Row) => (where.id === user.id ? { ...user } : null)), update, count: vi.fn(async () => 1) },
    tenant: { findUnique: vi.fn(async () => ({ id: 't-1' })), findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: Row) => { audit.push(e) }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = ADMIN })
  await app.register(userRoutes, { prefix: '/admin/users' })
  await app.ready()
  return {
    app, user, update, audit,
    add: (role: string) => app.inject({ method: 'POST', url: '/admin/users/u-1/roles', payload: { role } }),
    revoke: (role: string) => app.inject({ method: 'DELETE', url: `/admin/users/u-1/roles/${role}` }),
  }
}

describe('adding a role', () => {
  it('adds Contributor alongside Project manager, keeping the current role, and audits it', async () => {
    const t = await build({})
    const res = await t.add('contributor')
    expect(res.statusCode).toBe(200)
    expect(t.user).toMatchObject({ role: 'pm', additionalRoles: ['contributor'] })
    expect(t.audit[0]).toMatchObject({ action: 'user.role_added', details: { role: 'contributor', rolesFrom: ['pm'], rolesTo: ['pm', 'contributor'] } })
    await t.app.close()
  })

  it('refuses a third role, a duplicate, and the pairs that break separation of duties', async () => {
    const full = await build({ additionalRoles: ['contributor'] })
    expect((await full.add('auditor')).json().error).toBe('too_many_roles')
    await full.app.close()

    const t = await build({})
    expect((await t.add('pm')).json().error).toBe('duplicate_role')
    expect((await t.add('tenant-admin')).json().error).toBe('role_combination_not_allowed')
    await t.app.close()

    const c = await build({ role: 'contributor' })
    expect((await c.add('auditor')).json().error).toBe('role_combination_not_allowed')
    expect(c.update).not.toHaveBeenCalled()
    await c.app.close()
  })

  it('refuses an unknown role and a user who is not active', async () => {
    const t = await build({})
    expect((await t.add('guest')).statusCode).toBe(400)
    await t.app.close()
    const s = await build({ status: 'suspended' })
    expect((await s.add('contributor')).json().error).toBe('not_active')
    await s.app.close()
  })
})

describe('revoking a role', () => {
  it('revokes the additional role', async () => {
    const t = await build({ additionalRoles: ['contributor'] })
    expect((await t.revoke('contributor')).statusCode).toBe(200)
    expect(t.user).toMatchObject({ role: 'pm', additionalRoles: [] })
    expect(t.audit[0]).toMatchObject({ action: 'user.role_revoked', details: { role: 'contributor', rolesTo: ['pm'] } })
    await t.app.close()
  })

  it('revoking the primary role promotes the other one', async () => {
    const t = await build({ additionalRoles: ['contributor'] })
    expect((await t.revoke('pm')).statusCode).toBe(200)
    expect(t.user).toMatchObject({ role: 'contributor', additionalRoles: [] })
    await t.app.close()
  })

  it('never revokes the last role, nor one the user does not hold', async () => {
    const t = await build({})
    const res = await t.revoke('pm')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('last_role')
    expect((await t.revoke('auditor')).json().error).toBe('role_not_held')
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })
})

describe('the role filter and PATCH respect additional roles', () => {
  it('changing the primary role into a forbidden pair is refused', async () => {
    const t = await build({ additionalRoles: ['contributor'] })
    const res = await t.app.inject({ method: 'PATCH', url: '/admin/users/u-1', payload: { role: 'auditor' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('role_combination_not_allowed')
    await t.app.close()
  })

  it('a PM who also holds Contributor may be given capabilities', async () => {
    const t = await build({ additionalRoles: ['contributor'] })
    expect((await t.app.inject({ method: 'PATCH', url: '/admin/users/u-1', payload: { capabilities: ['can-author'] } })).statusCode).toBe(200)
    await t.app.close()
  })
})
