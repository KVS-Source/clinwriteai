// POST /:submissionId/ha-correspondence/:correspondenceId/questions/:questionId/generate
//
// Verifies the AI gateway wiring for the HA LoQ response draft stub.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'

vi.mock('../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { regAliasesAndStubs } = await import('./aliases-and-stubs.js')

const SUB = 'sub-1'
const CORR = 'corr-1'
const QID = 'q-1'

async function build(opts: {
  questionExists?: boolean
  gatewayFails?: 'rate-limit' | 'network' | null
} = {}) {
  const chat = vi.fn(async () => {
    if (opts.gatewayFails === 'rate-limit') {
      const e = new Error('monthly budget reached'); e.name = 'RateLimitedError'; throw e
    }
    if (opts.gatewayFails === 'network') throw new Error('ECONNRESET')
    return {
      responseText: 'The CMC data referenced in Section 3.2.P.3 has been updated with the new in-process controls (see Section 3.2.P.3.4).',
      model:        'claude-test',
      recordId:     'rec-55',
      inputTokens: 20, outputTokens: 40, costUsd: 0,
      limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    }
  })
  const audits: Array<Record<string, unknown>> = []
  const created: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    regulatorySubmission: {
      findUnique: vi.fn(async () => ({
        id: SUB, projectId: 'proj-1', submissionType: 'ind', targetHas: ['fda-esg'],
      })),
    },
    haLoqQuestion: {
      findFirst: vi.fn(async () => opts.questionExists === false ? null : ({
        id: QID, correspondenceId: CORR, questionRef: 'Q3', category: 'cmc',
        questionText: 'Clarify the in-process controls for drug substance manufacture.',
      })),
    },
    haResponseDraft: {
      findFirst: vi.fn(async () => null),
      create:    vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'draft-1', ...data, createdAt: new Date('2026-11-09T12:00:00Z') }
        created.push(row); return row
      }),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'aud-1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'regulatory-writer', modules: ['D'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(regAliasesAndStubs)
  await app.ready()
  return { app, chat, audits, created }
}

const generate = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: `/${SUB}/ha-correspondence/${CORR}/questions/${QID}/generate` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'D' })

describe('POST /:submissionId/ha-correspondence/:correspondenceId/questions/:questionId/generate', () => {
  it('calls the AI gateway with submission + question context and persists the draft', async () => {
    const { app, chat, audits, created } = await build()
    const res = await generate(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { responseDraft: string; aiModel: string; aiFootprintPct: number; stub?: boolean }
    expect(body).toMatchObject({ aiModel: 'claude-test', aiFootprintPct: 100 })
    expect(body.stub).toBeUndefined()
    expect(body.responseDraft).toMatch(/in-process controls/)

    const call = chat.mock.calls[0]![0] as { module: string; intent: string; prompt: string; projectId: string }
    expect(call).toMatchObject({ module: 'D', intent: 'ha_response_draft', projectId: 'proj-1' })
    expect(call.prompt).toContain('ind to fda-esg')
    expect(call.prompt).toContain('LoQ question Q3 (cmc)')
    expect(call.prompt).toContain('Clarify the in-process controls')

    expect(created[0]).toMatchObject({ aiFootprintPct: 100, status: 'draft', versionNumber: 1 })

    const rec = audits.find(e => e.action === 'ha_response_draft_generated')
    expect(rec?.details).toMatchObject({ model: 'claude-test', aiCallRecordId: 'rec-55' })
  })

  it('returns 429 quota_reached when the gateway raises RateLimitedError', async () => {
    const { app, created } = await build({ gatewayFails: 'rate-limit' })
    const res = await generate(app)
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_reached' })
    expect(created).toHaveLength(0)
  })

  it('falls back to a stub draft on non-quota gateway failure + audits with stub:true', async () => {
    const { app, audits, created } = await build({ gatewayFails: 'network' })
    const res = await generate(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { stub: boolean; aiModel: string; responseDraft: string }
    expect(body.stub).toBe(true)
    expect(body.aiModel).toBe('stub-fallback')
    expect(body.responseDraft).toMatch(/\[Information Required:/)
    expect(created[0]).toMatchObject({ aiFootprintPct: 100 })

    const rec = audits.find(e => e.action === 'ha_response_draft_generated')
    expect(rec?.details).toMatchObject({ model: 'stub-fallback', stub: true })
  })

  it('returns 404 when the question does not exist', async () => {
    const { app } = await build({ questionExists: false })
    const res = await generate(app)
    expect(res.statusCode).toBe(404)
  })
})
