// POST /med-content/:contentId/ai-suggest

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { medContentRoutes } = await import('./routes.js')

const CID = 'c-1'

async function build(opts: {
  itemExists?:   boolean
  gatewayFails?: 'rate-limit' | 'network' | null
} = {}) {
  const chat = vi.fn(async () => {
    if (opts.gatewayFails === 'rate-limit') {
      const e = new Error('monthly budget reached'); e.name = 'RateLimitedError'; throw e
    }
    if (opts.gatewayFails === 'network') throw new Error('ECONNRESET')
    return {
      responseText: 'Veloricept plus pembrolizumab significantly improved PFS versus pembrolizumab alone.',
      model:        'claude-test',
      recordId:     'rec-91',
      inputTokens:  10, outputTokens: 20, costUsd: 0,
      limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    }
  })
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    medContentItem: {
      findUnique: vi.fn(async () => opts.itemExists === false ? null : ({
        id: CID, projectId: 'proj-1', title: 'HCP Launch Deck',
        type: 'hcp_deck', complianceTrack: 'promotional',
      })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'a1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'medical-writer', modules: ['C'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(medContentRoutes)
  await app.ready()
  return { app, chat, audits }
}

const suggest = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/${CID}/ai-suggest`, payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'C' })

describe('POST /med-content/:contentId/ai-suggest', () => {
  it('calls the AI gateway with the content type + compliance track + user prompt and returns the text', async () => {
    const { app, chat, audits } = await build()
    const res = await suggest(app, { sectionId: 's4', prompt: 'Shorten to one sentence', currentContent: '<p>Original.</p>' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { responseText: string; aiModel: string; recordId: string; stub?: boolean }
    expect(body).toMatchObject({ aiModel: 'claude-test', recordId: 'rec-91' })
    expect(body.stub).toBeUndefined()
    expect(body.responseText).toMatch(/Veloricept plus pembrolizumab/)

    const call = chat.mock.calls[0]![0] as { module: string; intent: string; prompt: string; projectId: string }
    expect(call).toMatchObject({ module: 'C', intent: 'content_suggest', projectId: 'proj-1' })
    expect(call.prompt).toContain('HCP Launch Deck')
    expect(call.prompt).toContain('Type: hcp_deck')
    expect(call.prompt).toContain('Compliance track: promotional')
    expect(call.prompt).toContain('Section: s4')
    expect(call.prompt).toContain('Instruction: Shorten to one sentence')
    expect(call.prompt).toMatch(/\[Information Required:/)

    const rec = audits.find(e => e.action === 'ai_suggest_generated')
    expect(rec?.details).toMatchObject({ sectionId: 's4', model: 'claude-test', aiCallRecordId: 'rec-91' })
  })

  it('supplies a default instruction when prompt is missing', async () => {
    const { app, chat } = await build()
    await suggest(app, {})
    const promptSent = (chat.mock.calls[0]![0] as { prompt: string }).prompt
    expect(promptSent).toMatch(/Suggest improved wording/)
  })

  it('returns 404 when the content item does not exist', async () => {
    const { app } = await build({ itemExists: false })
    const res = await suggest(app)
    expect(res.statusCode).toBe(404)
  })

  it('returns 429 quota_reached when the gateway raises RateLimitedError', async () => {
    const { app, audits } = await build({ gatewayFails: 'rate-limit' })
    const res = await suggest(app)
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_reached' })
    expect(audits).toHaveLength(0)
  })

  it('falls back to a stub response on non-quota gateway failure + audits with stub-fallback', async () => {
    const { app, audits } = await build({ gatewayFails: 'network' })
    const res = await suggest(app, { sectionId: 's4', prompt: 'Make it one sentence' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { stub: boolean; aiModel: string; responseText: string }
    expect(body.stub).toBe(true)
    expect(body.aiModel).toBe('stub-fallback')
    expect(body.responseText).toMatch(/\[Information Required:/)

    const rec = audits.find(e => e.action === 'ai_suggest_generated')
    expect(rec?.details).toMatchObject({ model: 'stub-fallback', reason: 'ECONNRESET' })
  })
})
