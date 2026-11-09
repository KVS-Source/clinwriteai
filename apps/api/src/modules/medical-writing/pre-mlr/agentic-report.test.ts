// GET /med-content/:contentId/agentic-report
//
// Covers:
//   - Deterministic findings[] + scores unchanged (backward compat)
//   - advisoryNarrative populated from aiGateway on happy path
//   - 429 quota_reached when gateway raises RateLimitedError
//   - advisoryNarrative stays null + response still returns on non-quota failure
//   - 422 when no pre-MLR run exists / latest run failed

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/config/ai-engine-settings.js', () => ({ chooseModel: vi.fn(async () => 'claude-test') }))

const { preMlrRoutes } = await import('./routes.js')

const CID = 'c-1'

async function build(opts: {
  preMlrPassed?: boolean
  preMlrExists?: boolean
  gatewayFails?: 'rate-limit' | 'network' | null
} = {}) {
  const chat = vi.fn(async () => {
    if (opts.gatewayFails === 'rate-limit') {
      const e = new Error('monthly budget reached'); e.name = 'RateLimitedError'
      throw e
    }
    if (opts.gatewayFails === 'network') throw new Error('ECONNRESET')
    return {
      responseText: 'Package shows strong Library reuse (80%) with 2 minor should-fix editorial notes. Review note 3 before escalating.',
      model:        'claude-test',
      recordId:     'rec-11',
      inputTokens:  20, outputTokens: 40, costUsd: 0,
      limitDecision: 'allowed', piiScrubbed: false, piiCategories: [],
    }
  })
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    medContentItem: {
      findUnique: vi.fn(async () => ({
        id: CID, projectId: 'proj-1', title: 'HCP Launch Deck', type: 'hcp_deck',
        claims: [
          { approvalStatus: 'approved' },
          { approvalStatus: 'approved' },
          { approvalStatus: 'library_adopted' },
          { approvalStatus: 'needs_edit' },
          { approvalStatus: 'rejected' },
        ],
        preMlrRuns: opts.preMlrExists === false ? [] : [{
          id: 'run-1',
          passed:          opts.preMlrPassed ?? true,
          mustFixCount:    opts.preMlrPassed === false ? 1 : 0,
          shouldFixCount:  2,
          noteCount:       1,
          issues: [],
        }],
      })),
    },
  } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'aud-1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'medical-writer', modules: ['C'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(preMlrRoutes)
  await app.ready()
  return { app, chat, audits }
}

const get = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'GET', url: `/${CID}/agentic-report` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'C' })

describe('GET /med-content/:contentId/agentic-report', () => {
  it('returns advisoryNarrative from the AI gateway + deterministic findings + scores', async () => {
    const { app, chat, audits } = await build()
    const res = await get(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      model: string; advisoryNarrative: string | null
      scores: { overall: number; claimReusePct: number }
      findings: Array<{ category: string; severity: string; message: string }>
    }
    expect(body.model).toBe('claude-test')
    expect(body.advisoryNarrative).toMatch(/Package shows strong/)
    // 3 of 5 claims approved-or-library_adopted = 60%
    expect(body.scores.claimReusePct).toBe(60)
    // Deterministic findings still there: rejected + needs_edit + should-fix
    expect(body.findings.length).toBeGreaterThanOrEqual(3)

    const call = chat.mock.calls[0]![0] as { module: string; intent: string; prompt: string }
    expect(call).toMatchObject({ module: 'C', intent: 'agentic_mlr_advisory' })
    expect(call.prompt).toContain('HCP Launch Deck')
    expect(call.prompt).toContain('claim-reuse: 60%')

    const rec = audits.find(e => e.action === 'agentic_report_generated')
    expect(rec?.details).toMatchObject({ model: 'claude-test', aiCallRecordId: 'rec-11' })
  })

  it('returns 429 quota_reached when the gateway raises RateLimitedError', async () => {
    const { app } = await build({ gatewayFails: 'rate-limit' })
    const res = await get(app)
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_reached' })
  })

  it('still returns deterministic body with advisoryNarrative=null on non-quota gateway failure', async () => {
    const { app, audits } = await build({ gatewayFails: 'network' })
    const res = await get(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { advisoryNarrative: string | null; model: string; findings: unknown[] }
    expect(body.advisoryNarrative).toBeNull()
    expect(body.model).toBe('stub-advisor-v1')                  // fallback marker
    expect(body.findings.length).toBeGreaterThan(0)

    const rec = audits.find(e => e.action === 'agentic_report_generated')
    expect(rec?.details).toMatchObject({ model: 'stub-advisor-v1', aiCallRecordId: null })
  })

  it('returns 422 when no pre-MLR run exists', async () => {
    const { app } = await build({ preMlrExists: false })
    const res = await get(app)
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'pre_mlr_required' })
  })

  it('returns 422 when the latest pre-MLR run has must-fix issues (failed)', async () => {
    const { app } = await build({ preMlrPassed: false })
    const res = await get(app)
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'pre_mlr_failed' })
  })
})
