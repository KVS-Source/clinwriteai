// POST /:submissionId/redactions/auto-detect

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { consistencyRoutes } = await import('./routes.js')

const SUB = 'sub-1'

async function build(opts: {
  stage?: number
  submissionExists?: boolean
  gatewayFails?: 'rate-limit' | 'network' | null
  responseText?: string
} = {}) {
  const chat = vi.fn(async () => {
    if (opts.gatewayFails === 'rate-limit') {
      const e = new Error('monthly budget reached'); e.name = 'RateLimitedError'; throw e
    }
    if (opts.gatewayFails === 'network') throw new Error('ECONNRESET')
    return {
      responseText: opts.responseText ?? '```json\n{ "ppd": [{ "text": "Dr. Alice Smith", "location": "§2.1 Investigator list" }], "cci": [{ "text": "proprietary excipient blend ratio 3:1:1", "location": "§3.2.P.1" }] }\n```',
      model:        'claude-test',
      recordId:     'rec-77',
      inputTokens: 100, outputTokens: 50, costUsd: 0,
      limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    }
  })
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    regulatorySubmission: {
      findUnique: vi.fn(async () => opts.submissionExists === false ? null : ({
        id: SUB, projectId: 'proj-1', stage: opts.stage ?? 2,
      })),
    },
    redactionRecord: {
      findMany: vi.fn(async () => []),
      create:   vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r-1', ...data })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'a1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'regulatory-writer', modules: ['D'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(consistencyRoutes)
  await app.ready()
  return { app, chat, audits }
}

const autoDetect = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: `/${SUB}/redactions/auto-detect`, payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'D' })

describe('POST /:submissionId/redactions/auto-detect', () => {
  it('parses PPD + CCI items from the AI JSON output and returns them with confirmed=false', async () => {
    const { app, audits } = await build()
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'Dr. Alice Smith led the trial. The formulation uses our proprietary excipient blend ratio 3:1:1.' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      documentId: string
      ppdItems: Array<{ text: string; location: string; confirmed: boolean; id: string }>
      cciItems: Array<{ text: string; location: string; confirmed: boolean; id: string }>
      aiModel:  string
    }
    expect(body.documentId).toBe('doc-1')
    expect(body.aiModel).toBe('claude-test')
    expect(body.ppdItems).toHaveLength(1)
    expect(body.ppdItems[0]).toMatchObject({ text: 'Dr. Alice Smith', location: '§2.1 Investigator list', confirmed: false })
    expect(body.ppdItems[0]?.id).toMatch(/^[0-9a-f]{8}-/)
    expect(body.cciItems).toHaveLength(1)
    expect(body.cciItems[0]).toMatchObject({ text: 'proprietary excipient blend ratio 3:1:1', confirmed: false })

    const rec = audits.find(e => e.action === 'redaction_auto_detect_run')
    expect(rec?.details).toMatchObject({ ppdCount: 1, cciCount: 1, model: 'claude-test', aiCallRecordId: 'rec-77' })
  })

  it('returns empty arrays + parseReason when the AI response is not valid JSON', async () => {
    const { app } = await build({ responseText: 'I think these should be redacted: Dr Smith (page 4).' })
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'Some content.' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ppdItems: unknown[]; cciItems: unknown[]; parseReason: string }
    expect(body.ppdItems).toEqual([])
    expect(body.cciItems).toEqual([])
    expect(body.parseReason).toMatch(/parse_failed/)
  })

  it('returns 429 quota_reached on RateLimitedError', async () => {
    const { app } = await build({ gatewayFails: 'rate-limit' })
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'x' })
    expect(res.statusCode).toBe(429)
  })

  it('returns empty arrays + parseReason on non-quota gateway failure', async () => {
    const { app, audits } = await build({ gatewayFails: 'network' })
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'x' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ppdItems: unknown[]; parseReason: string; aiModel: string }
    expect(body.ppdItems).toEqual([])
    expect(body.aiModel).toBe('stub-fallback')
    expect(body.parseReason).toMatch(/ai_call_failed/)
    const rec = audits.find(e => e.action === 'redaction_auto_detect_run')
    expect(rec?.details).toMatchObject({ parseReason: expect.stringMatching(/ai_call_failed/) })
  })

  it('returns 422 redactions_locked at stage 5+', async () => {
    const { app } = await build({ stage: 5 })
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'x' })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'redactions_locked' })
  })

  it('returns 404 when the submission does not exist', async () => {
    const { app } = await build({ submissionExists: false })
    const res = await autoDetect(app, { documentId: 'doc-1', bodyText: 'x' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for missing documentId / empty body / body over 50KB', async () => {
    const { app } = await build()
    expect((await autoDetect(app, { documentId: 'doc-1' })).statusCode).toBe(400)
    expect((await autoDetect(app, { documentId: 'doc-1', bodyText: '' })).statusCode).toBe(400)
    expect((await autoDetect(app, { documentId: 'doc-1', bodyText: 'x'.repeat(50_001) })).statusCode).toBe(400)
  })
})
