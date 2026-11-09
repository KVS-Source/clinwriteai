// POST /review-rounds/:roundId/comments/:commentId/ai-draft
//
// Covers the three call paths:
//   - Happy path: aiGateway returns a draft, route returns it + audits
//   - Comment missing: 404
//   - Gateway throws RateLimitedError: 429 quota_reached
//   - Gateway throws anything else: stub fallback response + audit note

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { peerReviewRoutes } = await import('./routes.js')

const PUB = 'pub-1'
const ROUND = 'round-1'
const COMMENT = 'cmt-1'

async function build(opts: {
  commentExists?: boolean
  gatewayFails?:  'rate-limit' | 'network' | null
} = {}) {
  const chat = vi.fn(async () => {
    if (opts.gatewayFails === 'rate-limit') {
      const e = new Error('tenant monthly budget reached'); e.name = 'RateLimitedError'
      throw e
    }
    if (opts.gatewayFails === 'network') {
      throw new Error('ECONNRESET')
    }
    return {
      responseText: 'We thank the reviewer. The revised Methods section (page 7) now reports the stratification factors used in randomisation.',
      model:        'claude-test',
      recordId:     'rec-7',
      inputTokens:  10, outputTokens: 30, costUsd: 0,
      limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    }
  })
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    reviewerComment: {
      findFirst: vi.fn(async () => opts.commentExists === false ? null : {
        id: COMMENT, roundId: ROUND, reviewerTab: 'r1', commentNumber: 3,
        commentText: 'Please clarify the stratification factors used in randomisation.',
        responseText: '', status: 'not_started',
      }),
    },
    peerReviewRound: {
      findUnique: vi.fn(async () => ({ publicationId: PUB })),
    },
    publication: {
      findUnique: vi.fn(async () => ({ projectId: 'proj-1', title: 'VELORA-301 primary analysis' })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['B'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(peerReviewRoutes)
  await app.ready()
  return { app, chat, audit }
}

const draft = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: `/review-rounds/${ROUND}/comments/${COMMENT}/ai-draft` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'B' })

describe('POST /review-rounds/:roundId/comments/:commentId/ai-draft', () => {
  it('calls the AI gateway with the comment + manuscript title and returns the draft', async () => {
    const { app, chat, audit } = await build()
    const res = await draft(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { draftText: string; aiModel: string; recordId: string; stub?: boolean }
    expect(body).toMatchObject({
      aiModel:  'claude-test',
      recordId: 'rec-7',
    })
    expect(body.draftText).toMatch(/revised Methods/)
    expect(body.stub).toBeUndefined()

    const call = chat.mock.calls[0]![0] as { module: string; intent: string; prompt: string; projectId: string; maxOutputTokens: number }
    expect(call).toMatchObject({ module: 'B', intent: 'peer_review_draft', projectId: 'proj-1', maxOutputTokens: 1024 })
    expect(call.prompt).toContain('VELORA-301 primary analysis')
    expect(call.prompt).toContain('Reviewer 1')
    expect(call.prompt).toContain('comment #3')
    expect(call.prompt).toMatch(/\[Information Required:/)

    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'peer_review_ai_draft_generated')
    expect(rec?.details).toMatchObject({ model: 'claude-test', aiCallRecordId: 'rec-7' })
  })

  it('returns 404 when the comment does not exist', async () => {
    const { app } = await build({ commentExists: false })
    const res = await draft(app)
    expect(res.statusCode).toBe(404)
  })

  it('returns 429 quota_reached when the gateway raises RateLimitedError', async () => {
    const { app, audit } = await build({ gatewayFails: 'rate-limit' })
    const res = await draft(app)
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_reached' })
    // Audit NOT written on quota (only on success + non-rate-limit stub fallback).
    expect(audit).not.toHaveBeenCalled()
  })

  it('falls back to a stub draft when the gateway throws a non-quota error', async () => {
    const { app, audit } = await build({ gatewayFails: 'network' })
    const res = await draft(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { stub: boolean; aiModel: string; draftText: string }
    expect(body.stub).toBe(true)
    expect(body.aiModel).toBe('stub-fallback')
    expect(body.draftText).toMatch(/\[Information Required:/)

    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'peer_review_ai_draft_generated')
    expect(rec?.details).toMatchObject({ model: 'stub-fallback', reason: 'ECONNRESET' })
  })
})
