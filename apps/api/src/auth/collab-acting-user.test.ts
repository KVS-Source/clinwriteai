// The realtime sidecar (apps/collab-server) saves section content with the
// COLLAB_SYSTEM_TOKEN. It must name the author whose edit it is saving
// (x-acting-user); the request then runs as that user, so the normal author,
// status-lock and section-lock checks apply to them instead of to a privileged
// synthetic identity.

import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fp from 'fastify-plugin'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import authPlugin from './plugin.js'
import { requireAuth } from './rbac.js'

const TOKEN = 'collab-test-token-0123456789'
const USERS: Record<string, Record<string, unknown>> = {
  'u-author':   { id: 'u-author', email: 'a@x', role: 'contributor', capabilities: [], modules: ['A'], tenantId: 't-1', status: 'active' },
  'u-gone':     { id: 'u-gone', email: 'g@x', role: 'contributor', capabilities: [], modules: ['A'], tenantId: 't-1', status: 'suspended' },
}

let saved: { token?: string; bypass?: string }

async function build() {
  const app = Fastify()
  await app.register(fastifyCookie)
  app.decorate('secrets', { getSecret: async () => 'x'.repeat(40) } as never)
  app.decorate('env', { JWT_EXPIRY: '1h', SSO_PROVIDER: 'mock', NODE_ENV: 'test', EMAIL_FROM: 'n@x', CORS_ORIGIN: 'http://x', SESSION_COOKIE_DOMAIN: '' } as never)
  await app.register(fp(async (a) => {
    a.decorate('prisma', { user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null) } } as never)
  }, { name: 'prisma' }))
  await app.register(fp(async (a) => { a.decorate('audit', { append: vi.fn(async () => ({})) } as never) }, { name: 'audit' }))
  await app.register(authPlugin)
  app.get('/probe', { preHandler: requireAuth() }, async (request) => ({ id: request.user!.id, role: request.user!.role }))
  await app.ready()
  return app
}

beforeAll(() => {
  saved = { token: process.env.COLLAB_SYSTEM_TOKEN, bypass: process.env.AUTH_BYPASS_EMAIL }
  process.env.COLLAB_SYSTEM_TOKEN = TOKEN
  delete process.env.AUTH_BYPASS_EMAIL      // no fallback user: an unresolved request must stay anonymous
})
afterAll(() => {
  if (saved.token === undefined) delete process.env.COLLAB_SYSTEM_TOKEN; else process.env.COLLAB_SYSTEM_TOKEN = saved.token
  if (saved.bypass !== undefined) process.env.AUTH_BYPASS_EMAIL = saved.bypass
})

describe('collab sidecar requests run as the acting author', () => {
  it('system token + x-acting-user → the request is that user, with their own role', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-system-token': TOKEN, 'x-acting-user': 'u-author' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'u-author', role: 'contributor' })
    await app.close()
  })

  it.each([['an unknown user', 'u-nobody'], ['a suspended user', 'u-gone']])('naming %s leaves the request unauthenticated (401)', async (_l, id) => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-system-token': TOKEN, 'x-acting-user': id } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('without x-acting-user it is the synthetic sidecar, which may not edit content', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-system-token': TOKEN } })
    expect(res.json()).toMatchObject({ id: 'system:collab' })   // actorCanEditDocumentContent refuses this id (edit-gate.test.ts)
    await app.close()
  })

  it('a wrong token cannot borrow someone else\'s identity via x-acting-user', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-system-token': 'wrong', 'x-acting-user': 'u-author' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
