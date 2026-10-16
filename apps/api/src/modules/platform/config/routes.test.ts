// Admin config routes via inject() with a fake Prisma: /admin/test-connection
// (auth, no-key result, audit entry) and what /admin/config reports as "last tested".

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'
import { adminConfigRoutes } from './routes.js'

async function build(opts: { role?: Role | null; lastTest?: { timestamp: Date; details: Record<string, unknown> } | null; saved?: Record<string, unknown> | null } = {}) {
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    // The route asks for the latest audit event of one action: connection test vs saved engine settings.
    $queryRaw: vi.fn(async (_sql: unknown, action: string) =>
      action === 'ai_engine_config_saved' ? (opts.saved ? [{ details: opts.saved }] : [])
      : (opts.lastTest ? [opts.lastTest] : [])),
    tenant: { findUnique: vi.fn(async () => null) },
    user: { count: vi.fn(async () => 3) },
    subscription: { findFirst: vi.fn(async () => null) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  const role = opts.role === undefined ? 'admin' : opts.role
  app.addHook('onRequest', async (r) => {
    if (role === null) return
    const user: AuthenticatedUser = { id: 'u1', email: 'a@b.c', role, modules: [], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(adminConfigRoutes)
  await app.ready()
  return { app, append }
}

let current: FastifyInstance | null = null
const saved = { key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL_SONNET }
beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_MODEL_SONNET })
afterEach(async () => {
  await current?.close(); current = null
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key
  if (saved.model === undefined) delete process.env.ANTHROPIC_MODEL_SONNET; else process.env.ANTHROPIC_MODEL_SONNET = saved.model
})
const setup = async (o: Parameters<typeof build>[0] = {}) => { const b = await build(o); current = b.app; return b }

describe('POST /admin/test-connection', () => {
  it('requires a signed-in admin', async () => {
    expect((await (await setup({ role: null })).app.inject({ method: 'POST', url: '/admin/test-connection' })).statusCode).toBe(401)
    await current?.close()
    expect((await (await setup({ role: 'author' })).app.inject({ method: 'POST', url: '/admin/test-connection' })).statusCode).toBe(403)
  })

  it('with no key configured: answers "not-configured" (not a fake success) and audits it', async () => {
    const { app, append } = await setup()
    const res = await app.inject({ method: 'POST', url: '/admin/test-connection' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'not-configured', model: 'claude-sonnet-4-6', latency: null })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ai_connection_tested', entityType: 'ai_engine', actorId: 'u1',
      details: expect.objectContaining({ status: 'not-configured', latencyMs: null }),
    }))
  })

  it('tests the configured default model', async () => {
    process.env.ANTHROPIC_MODEL_SONNET = 'claude-sonnet-9'
    const { app } = await setup()
    expect((await app.inject({ method: 'POST', url: '/admin/test-connection' })).json().model).toBe('claude-sonnet-9')
  })

  it('reports a failure (e.g. SDK missing / bad key) and never echoes the key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-TOPSECRET'
    const { app, append } = await setup()
    const res = (await app.inject({ method: 'POST', url: '/admin/test-connection' })).json()
    expect(res.status).toBe('failed')
    expect(JSON.stringify(res)).not.toContain('TOPSECRET')
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ status: 'failed' }) }))
  })
})

describe('GET /admin/config — AI engine "last tested"', () => {
  it('has never been tested: no fake timestamp, status reflects whether a key exists', async () => {
    const none = (await (await setup()).app.inject({ method: 'GET', url: '/admin/config' })).json().aiEngine
    expect(none).toMatchObject({ lastTested: null, lastTestedLatencyMs: null, lastTestedStatus: 'not-configured' })
    await current?.close()
    process.env.ANTHROPIC_API_KEY = 'k'
    const withKey = (await (await setup()).app.inject({ method: 'GET', url: '/admin/config' })).json().aiEngine
    expect(withKey).toMatchObject({ lastTested: null, lastTestedStatus: 'never-tested' })
  })

  it('reports the last recorded test', async () => {
    const when = new Date('2026-10-16T09:30:00Z')
    const { app } = await setup({ lastTest: { timestamp: when, details: { status: 'connected', latencyMs: 412 } } })
    expect((await app.inject({ method: 'GET', url: '/admin/config' })).json().aiEngine)
      .toMatchObject({ lastTested: '2026-10-16T09:30:00.000Z', lastTestedLatencyMs: 412, lastTestedStatus: 'connected' })
  })
})


describe('PUT /admin/config/ai-engine', () => {
  const put = (app: FastifyInstance, payload: object) => app.inject({ method: 'PUT', url: '/admin/config/ai-engine', payload })
  const valid = { default: 'claude-opus-4-7', fallback: 'claude-haiku-4-5', perModuleOverrideEnabled: false }

  it('requires an admin', async () => {
    expect((await put((await setup({ role: null })).app, valid)).statusCode).toBe(401)
    await current?.close()
    expect((await put((await setup({ role: 'author' })).app, valid)).statusCode).toBe(403)
  })

  it('saves the choice to the audit trail together with the value it replaced', async () => {
    const { app, append } = await setup({ saved: { default: 'claude-sonnet-4-6', fallback: 'claude-haiku-4-5', perModuleOverrideEnabled: true } })
    const res = await put(app, valid)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ...valid })
    expect(res.json().availableEngines.find((e: { status: string }) => e.status === 'active').id).toBe('claude-opus-4-7')
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ai_engine_config_saved', entityType: 'ai_engine', actorId: 'u1',
      details: { ...valid, previous: { default: 'claude-sonnet-4-6', fallback: 'claude-haiku-4-5', perModuleOverrideEnabled: true } },
    }))
  })

  it('rejects unknown engines, a fallback equal to the default, and a malformed body — saving nothing', async () => {
    const { app, append } = await setup()
    expect((await put(app, { ...valid, default: 'gpt-4o' })).statusCode).toBe(400)
    expect((await put(app, { ...valid, fallback: valid.default })).statusCode).toBe(400)
    expect((await put(app, { default: 'x' })).statusCode).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })
})

describe('GET /admin/config reflects the saved AI engine', () => {
  it('shows the saved default / fallback / override, with exactly that engine active', async () => {
    const { app } = await setup({ saved: { default: 'claude-opus-4-7', fallback: 'claude-sonnet-4-6', perModuleOverrideEnabled: false } })
    const ai = (await app.inject({ method: 'GET', url: '/admin/config' })).json().aiEngine
    expect(ai).toMatchObject({ default: 'claude-opus-4-7', fallback: 'claude-sonnet-4-6', perModuleOverrideEnabled: false })
    expect(ai.availableEngines.filter((e: { status: string }) => e.status === 'active').map((e: { id: string }) => e.id)).toEqual(['claude-opus-4-7'])
  })

  it('"Test connection" tests the saved default engine', async () => {
    const { app } = await setup({ saved: { default: 'claude-opus-4-7', fallback: 'claude-haiku-4-5', perModuleOverrideEnabled: true } })
    expect((await app.inject({ method: 'POST', url: '/admin/test-connection' })).json().model).toBe('claude-opus-4-7')
  })
})
