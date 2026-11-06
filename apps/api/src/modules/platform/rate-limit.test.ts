// Who gets counted, and how much room they have. Real @fastify/rate-limit, in memory, with its hook on the
// same footing as server.ts: the plugin is registered before the hook that sets request.user.

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { DEFAULT_REQUESTS_PER_MINUTE, rateLimitCounting, SIGNED_IN_READS_PER_MINUTE } from './rate-limit.js'

async function build() {
  const app = Fastify({ logger: false })
  await app.register(import('@fastify/rate-limit'), { ...rateLimitCounting, skipOnError: true })
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const id = req.headers['x-user']
    if (id) (req as unknown as { user: AuthenticatedUser }).user = { id: String(id), email: 'e', role: 'contributor', modules: ['A'], tenantId: null } as AuthenticatedUser
  })
  app.get('/thing', async () => ({ ok: true }))
  app.post('/thing', async () => ({ ok: true }))
  app.get('/auth/me', async () => ({ ok: true }))
  app.get('/auth/callback', async () => ({ ok: true }))
  app.post('/sign-in', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  await app.ready()
  return app
}

type App = Awaited<ReturnType<typeof build>>
const hit = (app: App, times: number, method: 'GET' | 'POST', url: string, user?: string) => Promise.all(
  Array.from({ length: times }, () => app.inject({ method, url, ...(user && { headers: { 'x-user': user } }), ...(method === 'POST' && { payload: {} }) })),
)
const codes = (rows: Array<{ statusCode: number }>) => rows.map(r => r.statusCode)

describe('signed-in reads', () => {
  it('allow far more than one person can click, then refuse with a wait time', async () => {
    const app = await build()
    expect(codes(await hit(app, SIGNED_IN_READS_PER_MINUTE, 'GET', '/thing', 'u1')).every(c => c === 200)).toBe(true)
    const [over] = await hit(app, 1, 'GET', '/thing', 'u1')
    expect(over!.statusCode).toBe(429)
    expect(Number(over!.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('cover the ticket: 18 tabs at 15 calls each in a minute', async () => {
    const app = await build()
    expect(codes(await hit(app, 18 * 15, 'GET', '/thing', 'u1')).every(c => c === 200)).toBe(true)
  })

  it('are counted per person, so colleagues on one office IP do not share a limit', async () => {
    const app = await build()
    await hit(app, SIGNED_IN_READS_PER_MINUTE, 'GET', '/thing', 'u1')
    expect(codes(await hit(app, 1, 'GET', '/thing', 'u1'))).toEqual([429])
    expect(codes(await hit(app, 1, 'GET', '/thing', 'u2'))).toEqual([200])
  })
})

describe('writes', () => {
  it('keep the lower limit', async () => {
    const app = await build()
    expect(codes(await hit(app, DEFAULT_REQUESTS_PER_MINUTE, 'POST', '/thing', 'u1')).every(c => c === 200)).toBe(true)
    expect(codes(await hit(app, 1, 'POST', '/thing', 'u1'))).toEqual([429])
  })

  it('are not used up by reading', async () => {
    const app = await build()
    await hit(app, DEFAULT_REQUESTS_PER_MINUTE + 50, 'GET', '/thing', 'u1')
    expect(codes(await hit(app, 1, 'POST', '/thing', 'u1'))).toEqual([200])
  })

  it('being used up does not stop reading', async () => {
    const app = await build()
    await hit(app, DEFAULT_REQUESTS_PER_MINUTE + 1, 'POST', '/thing', 'u1')
    expect(codes(await hit(app, 1, 'GET', '/thing', 'u1'))).toEqual([200])
  })
})

describe('anonymous requests', () => {
  it('stay at the lower limit, counted by IP', async () => {
    const app = await build()
    expect(codes(await hit(app, DEFAULT_REQUESTS_PER_MINUTE, 'GET', '/thing')).every(c => c === 200)).toBe(true)
    expect(codes(await hit(app, 1, 'GET', '/thing'))).toEqual([429])
  })
})

describe('exempt routes', () => {
  it.each(['/auth/me', '/auth/me?x=1', '/auth/callback'])('%s is never limited', async (url) => {
    const app = await build()
    expect(codes(await hit(app, SIGNED_IN_READS_PER_MINUTE + 20, 'GET', url, 'u1')).every(c => c === 200)).toBe(true)
  })
})

describe('a route with its own limit', () => {
  it('keeps that stricter limit', async () => {
    const app = await build()
    expect(codes(await hit(app, 2, 'POST', '/sign-in'))).toEqual([200, 200])
    expect(codes(await hit(app, 1, 'POST', '/sign-in'))).toEqual([429])
  })
})
