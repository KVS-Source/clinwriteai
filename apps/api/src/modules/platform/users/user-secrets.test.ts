// The admin user routes must never send a password hash or a reset-token hash to the browser: User
// Management used to receive the whole database row for every user.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
vi.mock('./issue-invitation.js', () => ({
  issueUserInvitation: vi.fn(async () => ({ inviteExpiresAt: '2026-12-01T00:00:00.000Z', emailQueued: true })),
}))

import { userRoutes } from './routes.js'
import { publicUser } from './public-user.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const ADMIN: AuthenticatedUser = { id: 'u-admin', email: 'a@x.io', role: 'tenant-admin', capabilities: [], modules: ['A'], tenantId: 't-1' }
const SECRETS = { passwordHash: '$2b$10$SECRETHASHVALUE', passwordResetTokenHash: 'RESETTOKENHASHVALUE', passwordResetExpiresAt: new Date('2026-12-01T00:00:00Z') }
const row = (over: Row = {}): Row => ({
  id: 'u-1', email: 'p@x.io', name: 'Pat', role: 'pm', additionalRoles: [], capabilities: [], modules: ['A'], status: 'active', tenantId: 't-1', ...SECRETS, ...over,
})

async function build() {
  const user = row()
  const app = Fastify()
  app.decorate('prisma', {
    user: {
      findMany: vi.fn(async () => [row(), row({ id: 'u-2', email: 'q@x.io' })]),
      findFirst: vi.fn(async ({ where }: Row) => (where.id === user.id ? { ...user } : null)),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: Row) => row({ ...data, id: 'u-new', status: 'invited' })),
      update: vi.fn(async ({ data }: Row) => ({ ...Object.assign(user, data) })),
      count: vi.fn(async () => 2),
    },
    tenant: { findUnique: vi.fn(async () => ({ id: 't-1' })), findMany: vi.fn(async () => [{ id: 't-1', name: 'Acme' }]) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = ADMIN })
  await app.register(userRoutes, { prefix: '/admin/users' })
  await app.ready()
  return app
}

const leaks = (body: string) => /passwordHash|passwordResetTokenHash|passwordResetExpiresAt|SECRETHASHVALUE|RESETTOKENHASHVALUE/.test(body)

describe('admin user routes send no password material', () => {
  it('publicUser drops the hashes and keeps everything else', () => {
    const out = publicUser(row()) as Row
    expect(out).not.toHaveProperty('passwordHash')
    expect(out).not.toHaveProperty('passwordResetTokenHash')
    expect(out).not.toHaveProperty('passwordResetExpiresAt')
    expect(out).toMatchObject({ id: 'u-1', email: 'p@x.io', role: 'pm' })
  })

  it('the list (flat and paged) and one user', async () => {
    const app = await build()
    const flat = await app.inject({ method: 'GET', url: '/admin/users' })
    expect(flat.statusCode).toBe(200)
    expect(leaks(flat.body)).toBe(false)
    expect(flat.json()[0]).toMatchObject({ id: 'u-1', tenantName: 'Acme' })
    const paged = await app.inject({ method: 'GET', url: '/admin/users?page=1&pageSize=10' })
    expect(leaks(paged.body)).toBe(false)
    expect(paged.json().items).toHaveLength(2)
    const one = await app.inject({ method: 'GET', url: '/admin/users/u-1' })
    expect(one.statusCode).toBe(200)
    expect(leaks(one.body)).toBe(false)
    await app.close()
  })

  it('the responses of invite, update, add role, revoke role', async () => {
    const app = await build()
    const invite = await app.inject({ method: 'POST', url: '/admin/users', payload: { firstName: 'New', lastName: 'Person', email: 'new@x.io', role: 'contributor', modules: ['A'] } })
    expect([200, 201]).toContain(invite.statusCode)
    expect(leaks(invite.body)).toBe(false)
    const patch = await app.inject({ method: 'PATCH', url: '/admin/users/u-1', payload: { name: 'Pat Two' } })
    expect(patch.statusCode).toBe(200)
    expect(leaks(patch.body)).toBe(false)
    const add = await app.inject({ method: 'POST', url: '/admin/users/u-1/roles', payload: { role: 'contributor' } })
    expect(add.statusCode).toBe(200)
    expect(leaks(add.body)).toBe(false)
    const revoke = await app.inject({ method: 'DELETE', url: '/admin/users/u-1/roles/contributor' })
    expect(revoke.statusCode).toBe(200)
    expect(leaks(revoke.body)).toBe(false)
    await app.close()
  })
})
