// User Management "Roles" panel: an admin adds and revokes a contributor's capabilities (Author,
// Reviewer, Approver, QC, Publisher) through PATCH /admin/users/:id. The list is replaced as sent,
// duplicates collapse, only contributors hold capabilities, and every change is audited.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { userRoutes } from './routes.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const ADMIN: AuthenticatedUser = { id: 'u-admin', email: 'a@x.io', role: 'tenant-admin', capabilities: [], modules: ['A'], tenantId: 't-1' }

async function build(target: Row) {
  const user = { id: 'u-1', email: 'c@x.io', name: 'Casey', role: 'contributor', additionalRoles: [], capabilities: ['can-author'], modules: ['A'], status: 'active', tenantId: 't-1', ...target }
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
  const patch = (body: Row) => app.inject({ method: 'PATCH', url: '/admin/users/u-1', payload: body })
  return { app, user, update, audit, patch }
}

describe('PATCH /admin/users/:id — capabilities (the panel’s roles)', () => {
  it('adds a capability: the list is saved as sent, and the change is audited from → to', async () => {
    const t = await build({})
    const res = await t.patch({ capabilities: ['can-author', 'can-review'] })
    expect(res.statusCode).toBe(200)
    expect(t.user.capabilities).toEqual(['can-author', 'can-review'])
    expect(t.audit[0]).toMatchObject({
      action: 'user.update', entityId: 'u-1',
      details: { changedFields: ['capabilities'], capabilitiesFrom: ['can-author'], capabilitiesTo: ['can-author', 'can-review'] },
    })
    await t.app.close()
  })

  it('revokes one by sending the list without it — down to none', async () => {
    const t = await build({ capabilities: ['can-author', 'can-qc'] })
    expect((await t.patch({ capabilities: ['can-qc'] })).statusCode).toBe(200)
    expect((await t.patch({ capabilities: [] })).statusCode).toBe(200)
    expect(t.user.capabilities).toEqual([])
    await t.app.close()
  })

  it('has no cap: all five can be held, and duplicates collapse', async () => {
    const t = await build({})
    const all = ['can-author', 'can-review', 'can-approve', 'can-qc', 'can-publish']
    expect((await t.patch({ capabilities: [...all, 'can-review'] })).statusCode).toBe(200)
    expect(t.user.capabilities).toEqual(all)
    await t.app.close()
  })

  it('refuses an unknown capability', async () => {
    const t = await build({})
    expect((await t.patch({ capabilities: ['can-sign-anything'] })).statusCode).toBe(400)
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it.each(['pm', 'auditor', 'tenant-admin'])('a %s cannot hold capabilities (no RACI letters for them)', async (role) => {
    const t = await build({ role, capabilities: [] })
    const res = await t.patch({ capabilities: ['can-review'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('capabilities_not_applicable')
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('changing a PM to Contributor and giving capabilities in one request works', async () => {
    const t = await build({ role: 'pm', capabilities: [] })
    expect((await t.patch({ role: 'contributor', capabilities: ['can-author'] })).statusCode).toBe(200)
    expect(t.user).toMatchObject({ role: 'contributor', capabilities: ['can-author'] })
    await t.app.close()
  })
})
