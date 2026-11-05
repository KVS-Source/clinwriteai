// Using the app counts as activity: every successful signed-in request stamps
// lastActiveAt (at most once a minute per user), so the inactivity sweep never
// treats someone working in the app as inactive. Synthetic system callers and
// failed requests don't count.

import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fp from 'fastify-plugin'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import authPlugin from './plugin.js'
import { requireAuth } from './rbac.js'

const TOKEN = 'collab-test-token-0123456789'
const USERS: Record<string, Record<string, unknown>> = {
  'u-1': { id: 'u-1', email: 'a@x', role: 'contributor', capabilities: [], modules: ['A'], tenantId: 't-1', status: 'active' },
}

let saved: { token?: string; bypass?: string }

async function build() {
  const app = Fastify()
  await app.register(fastifyCookie)
  app.decorate('secrets', { getSecret: async () => 'x'.repeat(40) } as never)
  app.decorate('env', { JWT_EXPIRY: '1h', SSO_PROVIDER: 'mock', NODE_ENV: 'test', EMAIL_FROM: 'n@x', CORS_ORIGIN: 'http://x', SESSION_COOKIE_DOMAIN: '' } as never)
  const updateMany = vi.fn(async () => ({ count: 1 }))
  await app.register(fp(async (a) => {
    a.decorate('prisma', { user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null), updateMany } } as never)
  }, { name: 'prisma' }))
  await app.register(fp(async (a) => { a.decorate('audit', { append: vi.fn(async () => ({})) } as never) }, { name: 'audit' }))
  await app.register(authPlugin)
  app.get('/ok', { preHandler: requireAuth() }, async () => ({ ok: true }))
  app.get('/fail', { preHandler: requireAuth() }, async (_req, reply) => reply.code(409).send({ error: 'nope' }))
  await app.ready()
  // Signed in as u-1 (the acting-user path resolves a real user without a cookie).
  const as = (headers: Record<string, string>) => ({ 'x-system-token': TOKEN, ...headers })
  return { app, updateMany, get: (url: string, headers: Record<string, string> = { 'x-acting-user': 'u-1' }) => app.inject({ method: 'GET', url, headers: as(headers) }) }
}

beforeAll(() => {
  saved = { token: process.env.COLLAB_SYSTEM_TOKEN, bypass: process.env.AUTH_BYPASS_EMAIL }
  process.env.COLLAB_SYSTEM_TOKEN = TOKEN
  delete process.env.AUTH_BYPASS_EMAIL
})
afterAll(() => {
  if (saved.token === undefined) delete process.env.COLLAB_SYSTEM_TOKEN; else process.env.COLLAB_SYSTEM_TOKEN = saved.token
  if (saved.bypass !== undefined) process.env.AUTH_BYPASS_EMAIL = saved.bypass
})

describe('app use counts as activity', () => {
  it('a successful signed-in request stamps lastActiveAt for that user', async () => {
    const t = await build()
    expect((await t.get('/ok')).statusCode).toBe(200)
    expect(t.updateMany).toHaveBeenCalledTimes(1)
    const arg = (t.updateMany.mock.calls[0] as unknown as [{ where: { id: string }; data: { lastActiveAt: Date } }])[0]
    expect(arg.where.id).toBe('u-1')
    expect(arg.data.lastActiveAt).toBeInstanceOf(Date)
    await t.app.close()
  })

  it('writes at most once a minute per user', async () => {
    const t = await build()
    await t.get('/ok'); await t.get('/ok'); await t.get('/ok')
    expect(t.updateMany).toHaveBeenCalledTimes(1)
    await t.app.close()
  })

  it('a failed request does not count', async () => {
    const t = await build()
    expect((await t.get('/fail')).statusCode).toBe(409)
    expect(t.updateMany).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('the synthetic system caller (system:collab) does not count', async () => {
    const t = await build()
    await t.get('/ok', {})
    expect(t.updateMany).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('an anonymous request does not count', async () => {
    const t = await build()
    expect((await t.app.inject({ method: 'GET', url: '/ok' })).statusCode).toBe(401)
    expect(t.updateMany).not.toHaveBeenCalled()
    await t.app.close()
  })
})
