// GET /auth/me must carry the display name + initials the UI shows as "you" —
// the session only holds id / email / role / modules.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from './rbac.js'
import { authRoutes, initialsOf } from './routes.js'

async function build(opts: { user?: AuthenticatedUser | null; row?: { name: string; initials: string | null; mustChangePassword?: boolean } | null; dbFails?: boolean } = {}) {
  const app = Fastify()
  const findUnique = vi.fn(async () => {
    if (opts.dbFails) throw new Error('db down')
    return opts.row === undefined ? { name: 'Mr Rohan Iyer', initials: 'MR' } : opts.row
  })
  app.decorate('prisma', { user: { findUnique } } as never)
  app.decorateRequest('user', null)
  const user = opts.user === undefined
    ? { id: 'u1', email: 'admin@clinwrite.ai', role: 'admin', modules: ['A'], tenantId: null } as AuthenticatedUser
    : opts.user
  app.addHook('onRequest', async (r) => { if (user) Object.assign(r, { user }) })
  await app.register(authRoutes)
  await app.ready()
  return { app, findUnique }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })
const setup = async (o: Parameters<typeof build>[0] = {}) => { const b = await build(o); current = b.app; return b }

describe('GET /auth/me', () => {
  it('returns the session user plus name and initials from the user row', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'u1', email: 'admin@clinwrite.ai', role: 'admin', name: 'Mr Rohan Iyer', initials: 'MR' })
  })

  it('derives initials when the row has none', async () => {
    const { app } = await setup({ row: { name: 'Dr Elena Vasquez', initials: null } })
    expect((await app.inject({ method: 'GET', url: '/auth/me' })).json()).toMatchObject({ name: 'Dr Elena Vasquez', initials: 'EV' })
  })

  it('falls back to the email for a user with no row (e.g. the collab sidecar) and survives a db error', async () => {
    const noRow = await setup({ row: null })
    expect((await noRow.app.inject({ method: 'GET', url: '/auth/me' })).json()).toMatchObject({ name: 'admin@clinwrite.ai', initials: 'AC' })
    await current?.close()
    const dbDown = await setup({ dbFails: true })
    expect((await dbDown.app.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(200)
  })

  it('reports mustChangePassword so a temp-password session stays on the set-password screen', async () => {
    const temp = await setup({ row: { name: 'New User', initials: 'NU', mustChangePassword: true } })
    expect((await temp.app.inject({ method: 'GET', url: '/auth/me' })).json()).toMatchObject({ mustChangePassword: true })
    await current?.close()
    const normal = await setup()
    expect((await normal.app.inject({ method: 'GET', url: '/auth/me' })).json()).toMatchObject({ mustChangePassword: false })
  })

  it('requires a signed-in user', async () => {
    const { app } = await setup({ user: null })
    expect((await app.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(401)
  })
})

describe('GET /auth/demo-personas', () => {
  it('lists every role each person holds, primary first, so the switcher can show a Contributor + PM as both', async () => {
    const prev = process.env.AUTH_BYPASS_EMAIL
    process.env.AUTH_BYPASS_EMAIL = 'demo@clinwrite.ai'
    try {
      const app = Fastify()
      app.decorate('prisma', { user: { findMany: vi.fn(async () => [
        { id: 'u-abh', name: 'Abhishek', email: 'a@x', role: 'contributor', additionalRoles: ['pm'], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 't1' },
        { id: 'u-alex', name: 'Alex Thornton', email: 'b@x', role: 'pm', additionalRoles: [], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 't1' },
      ]) } } as never)
      app.decorateRequest('user', null)
      app.addHook('onRequest', async (r) => { Object.assign(r, { user: { id: 'u1', email: 'x@x', role: 'contributor', modules: ['A'], tenantId: 't1' } }) })
      await app.register(authRoutes)
      current = app
      const res = await app.inject({ method: 'GET', url: '/auth/demo-personas' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([
        expect.objectContaining({ id: 'u-abh', role: 'contributor', roles: ['contributor', 'pm'] }),
        expect.objectContaining({ id: 'u-alex', role: 'pm', roles: ['pm'] }),
      ])
      expect(res.json()[0]).not.toHaveProperty('additionalRoles')
    } finally {
      if (prev === undefined) delete process.env.AUTH_BYPASS_EMAIL; else process.env.AUTH_BYPASS_EMAIL = prev
    }
  })
})

describe('initialsOf', () => {
  it.each([['Mr Rohan Iyer', 'RI'], ['Dr. Elena Vasquez', 'EV'], ['Alex Thornton', 'AT'], ['madonna', 'M']])('%s → %s', (n, i) => expect(initialsOf(n)).toBe(i))
})
