// PUT /documents/:id/ai-cost-limit (a PM sets, raises or removes a document's AI cost limit) and Resume of a draft
// paused at its limit.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../projects/visibility.js', async (original) => ({ ...(await original<object>()), canSeeDocument: async () => true }))
vi.mock('./ai-draft-preflight.js', () => ({ computeDraftPreflight: async () => ({ ok: false, issues: [{ code: 'no_sources' }] }) }))

const RATE = { model: 'claude-sonnet-4-6', inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 }

async function build(role: string, doc: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = []
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ id: 'd', deletedAt: null, projectId: 'p', type: 'protocol', assigneeId: 'u', currentVersionId: 'v', ...doc })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {} }),
    },
    // 1M input + 100k output: 4.5 USD spent.
    aiDraftStep: { findMany: async () => [{ details: { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 100_000 } }] },
    rateCardVersion: { findFirst: async () => ({ id: 'rc', version: 'v-test', entries: [{ ...RATE }] }) },
    platformSettings: { findUnique: async () => ({ localisation: { currency: 'INR', usdRate: 84 } }) },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'pm-1', email: 'pm@x.io', role, modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  const { documentsRoutes } = await import('./routes.js')
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, updates, audit }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('PUT /documents/:id/ai-cost-limit', () => {
  it('a PM sets the limit in the install’s currency; it is kept in USD and audited', async () => {
    const { app, updates, audit } = await build('pm', { aiCostLimit: null })
    const res = await app.inject({ method: 'PUT', url: '/documents/d/ai-cost-limit', payload: { amount: 840 } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ limit: { amount: 840, currency: 'INR', usd: 10 }, spent: 378, currency: 'INR' })
    expect(updates[0]!.aiCostLimit).toMatchObject({ usd: 10, amount: 840, currency: 'INR', usdRate: 84, setBy: 'pm-1' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.ai_cost_limit_changed', details: { before: null, after: { amount: 840, currency: 'INR', usd: 10 } },
    }))
  })
  it('null removes it; only a PM may change it', async () => {
    const { app, updates } = await build('pm', { aiCostLimit: { usd: 5, amount: 420, currency: 'INR', usdRate: 84 } })
    expect((await app.inject({ method: 'PUT', url: '/documents/d/ai-cost-limit', payload: { amount: null } })).json()).toMatchObject({ limit: null })
    expect(updates[0]!.aiCostLimit).not.toHaveProperty('usd')
    const writer = await build('contributor', { aiCostLimit: null })
    expect((await writer.app.inject({ method: 'PUT', url: '/documents/d/ai-cost-limit', payload: { amount: 840 } })).statusCode).toBe(403)
  })
})

describe('Resume of a draft paused at its cost limit', () => {
  it('still at the limit: refused with what was spent and how to go on', async () => {
    const { app, updates } = await build('contributor', { aiDraftState: 'paused', aiCostLimit: { usd: 4, amount: 336, currency: 'INR', usdRate: 84 } })
    const res = await app.inject({ method: 'POST', url: '/documents/d/ai-draft/resume', payload: {} })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'cost_limit_reached' })
    expect(res.json().message).toMatch(/spent 378 INR of its 336 INR AI cost limit, and its next AI call would pass it\. A project manager can raise the limit in AI Debug, then Resume\./)
    expect(updates).toEqual([])
  })
  it('spent below the limit but the next call like the last would pass it: still refused (same rule as the drafter)', async () => {
    const { app } = await build('contributor', { aiDraftState: 'paused', aiCostLimit: { usd: 6, amount: 504, currency: 'INR', usdRate: 84 } })
    expect((await app.inject({ method: 'POST', url: '/documents/d/ai-draft/resume', payload: {} })).json()).toMatchObject({ error: 'cost_limit_reached' })
  })
  it('limit raised: Resume goes on (here to the pre-check)', async () => {
    const { app } = await build('contributor', { aiDraftState: 'paused', aiCostLimit: { usd: 10, amount: 840, currency: 'INR', usdRate: 84 } })
    const res = await app.inject({ method: 'POST', url: '/documents/d/ai-draft/resume', payload: {} })
    expect(res.json()).toMatchObject({ error: 'draft_blocked' })
  })
})
