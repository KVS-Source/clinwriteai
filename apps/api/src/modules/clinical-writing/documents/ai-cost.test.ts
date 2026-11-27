// AI drafting cost (ai-cost.ts, worker cost-guard.ts): the estimate shown at New Document when the policy has it on,
// the limit the PM may set, and the draft pausing before an AI call would pass it. Prices come from the rate card.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { costLimitAllowed, documentSpendUsd, estimateDraftCost, localCurrency, toLocal, toUsd } from './ai-cost.js'
import { CostGuard } from '../../../../../worker/src/jobs/cost-guard.js'

vi.mock('../../platform/config/ai-engine-settings.js', async (original) => ({
  ...(await original<object>()), chooseModel: async () => 'claude-sonnet-4-6',
}))

const RATE = { model: 'claude-sonnet-4-6', inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 }
const settings = (localisation: Record<string, unknown>) => ({ platformSettings: { findUnique: async () => ({ localisation }) } })

describe('currency', () => {
  it('USD, a local currency with its rate, or USD when the rate is missing', async () => {
    expect(await localCurrency(settings({}) as never)).toEqual({ currency: 'USD', usdRate: 1, rateMissing: false })
    const inr = await localCurrency(settings({ currency: 'inr', usdRate: 84 }) as never)
    expect(inr).toEqual({ currency: 'INR', usdRate: 84, rateMissing: false })
    expect(toLocal(12.5, inr)).toBe(1050)
    expect(toUsd(1050, inr)).toBe(12.5)
    expect(await localCurrency(settings({ currency: 'EUR' }) as never)).toEqual({ currency: 'USD', usdRate: 1, rateMissing: true })
  })
})

describe('the estimate', () => {
  const base = { sections: 50, sourceChars: 1_350_000, sourcePages: 722, scannedPages: 15, pagesBudgetChars: null, factSheet: true, rate: RATE }
  it('a range: low below high, both positive, with the time', () => {
    const e = estimateDraftCost(base)
    expect(e.lowUsd).toBeGreaterThan(0)
    expect(e.highUsd).toBeGreaterThan(e.lowUsd)
    expect(e.minutesHigh).toBeGreaterThanOrEqual(e.minutesLow)
    expect(e.basis).toMatchObject({ sections: 50, cached: true, validationPasses: [1, 3] })
  })
  it('relevant pages cost less than every file to every section; more sections cost more; prices scale it', () => {
    const all = estimateDraftCost(base)
    const pages = estimateDraftCost({ ...base, pagesBudgetChars: 80_000 })
    expect(pages.basis.perSectionSourceTokens).toBe(Math.round(80_000 / 3.5))
    expect(estimateDraftCost({ ...base, sections: 80 }).highUsd).toBeGreaterThan(all.highUsd)
    const double = estimateDraftCost({ ...base, rate: { ...RATE, inputPer1M: 6, outputPer1M: 30, cachedInputPer1M: 0.6 } })
    expect(double.highUsd).toBeCloseTo(all.highUsd * 2, 1)
    expect(pages.lowUsd).toBeGreaterThan(0)
  })
  it('short sources go as PDFs, so their pages also count as images', () => {
    const short = estimateDraftCost({ ...base, sourceChars: 100_000, sourcePages: 40, scannedPages: 0 })
    expect(short.basis.sourceTokens).toBe(Math.round(100_000 / 3.5 + 40 * 1_500))
  })
})

describe('what a document has spent', () => {
  it('every step with tokens, priced with the active rate card (cached input at its own rate)', async () => {
    const prisma = {
      aiDraftStep: { findMany: async () => [
        { details: { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 100_000 } },
        { details: { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 } },
        { details: { message: 'no tokens' } },
      ] },
      rateCardVersion: { findFirst: async () => ({ id: 'rc', version: 'v-test', entries: [{ ...RATE }] }) },
    }
    // 3 + 1.5 for the first call, 0.3 for the cached one.
    expect(await documentSpendUsd(prisma as never, 'd')).toBe(4.8)
  })
})

describe('the cost guard in the drafter', () => {
  const guard = (limit: number) => new CostGuard(limit, 0, 0, [RATE], { code: 'INR', usdRate: 84 })
  it('pauses when spent plus a call like the last one would pass the limit, and says so in the local currency', () => {
    const g = guard(0.9)
    g.add({ model: 'claude-sonnet-4-6', inputTokens: 100_000, outputTokens: 2_000 })      // 0.33 USD
    expect(g.reached).toBe(false)                                                          // 0.33 + 0.33 < 0.9
    g.add({ model: 'claude-sonnet-4-6', inputTokens: 100_000, outputTokens: 2_000 })
    expect(g.reached).toBe(true)                                                           // 0.66 + 0.33 > 0.9
    expect(g.describe()).toMatch(/AI cost limit of 75\.60 INR would be passed by the next AI call \(55\.44 INR spent so far\)/)
  })
  it('a model missing from the rate card is priced as "unknown", or not at all', () => {
    const g = new CostGuard(1, 0, 0, [{ model: 'unknown', inputPer1M: 5, outputPer1M: 25, cachedInputPer1M: 0.5 }], { code: 'USD', usdRate: 1 })
    expect(g.price({ model: 'other', inputTokens: 1_000_000, outputTokens: 0 })).toBe(5)
    expect(guard(1).price({ model: 'other', inputTokens: 1_000_000, outputTokens: 0 })).toBe(0)
  })
})

describe('POST /projects/:id/documents/cost-estimate', () => {
  async function build(policy: Record<string, unknown> | null, localisation: Record<string, unknown> = {}) {
    const app = Fastify()
    const inspection = { usable: true, chars: 700_000, pages: 300, scannedPages: 0, sha256: 'x', kind: 'pdf', problem: null }
    app.decorate('prisma', {
      projectMember: { findMany: async () => [{ projectId: 'proj-1' }] },
      projectTeamMember: { findMany: async () => [] },
      raciAssignment: { findMany: async () => [] },
      crmAttendee: { findMany: async () => [] },
      document: { findMany: async () => [] },
      documentTypePolicy: { findFirst: async () => policy },
      documentUpload: { findMany: async () => [{ id: 'u1', title: 'IB', fileName: 'ib.pdf', sourceCategory: 'ib', version: null, classification: { inspection } }] },
      documentTemplate: {
        findUnique: async () => null,
        findFirst: async () => ({ sections: ['1', '1.1', '1.2', '2', '2.1', '12'].map(number => ({ number })) }),
      },
      rateCardVersion: { findFirst: async () => ({ id: 'rc', version: 'v-test', entries: [{ ...RATE }] }) },
      ...settings(localisation),
    } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const user: AuthenticatedUser = { id: 'pm-1', email: 'pm@x.io', role: 'pm', modules: ['A'], tenantId: null }
      ;(req as unknown as { user: AuthenticatedUser }).user = user
    })
    const { documentsProjectScopedRoutes } = await import('./routes.js')
    await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
    await app.ready()
    return (body = { type: 'protocol', sources: [{ uploadId: 'u1', role: 'evidence' }] }) =>
      app.inject({ method: 'POST', url: '/projects/proj-1/documents/cost-estimate', payload: body })
  }
  beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

  it('nothing when the policy does not allow a cost limit (the default for a policy)', async () => {
    expect((await (await build({ costLimitEnabled: false, buildPlan: null }))()).json()).toEqual({ enabled: false })
  })

  it('a document type with no policy gets the estimate, every template section counted (no build plan: all are drafted)', async () => {
    const res = (await (await build(null))()).json()
    expect(res).toMatchObject({ enabled: true, available: true })
    expect(res.basis.sections).toBe(6)                                                     // no build plan: the drafter writes every section
  })

  it('costLimitAllowed: a policy decides; no policy allows it', () => {
    expect(costLimitAllowed(null)).toBe(true)
    expect(costLimitAllowed({ costLimitEnabled: true })).toBe(true)
    expect(costLimitAllowed({ costLimitEnabled: false })).toBe(false)
    expect(costLimitAllowed({})).toBe(false)
  })

  it('a range in the install’s currency, for the sections the plan drafts', async () => {
    const plan = { builtByCode: [{ number: '12', kind: 'references' }], factSheet: { fields: [] } }
    const res = (await (await build({ costLimitEnabled: true, buildPlan: plan, templateId: null }, { currency: 'INR', usdRate: 84 }))()).json()
    expect(res).toMatchObject({ enabled: true, available: true, currency: 'INR', rateMissing: false, model: 'claude-sonnet-4-6', rateCardVersion: 'v-test' })
    expect(res.basis.sections).toBe(3)                                                     // 1.1, 1.2, 2.1: headings 1 and 2 and References are not drafted
    expect(res.low).toBeCloseTo(res.lowUsd * 84, 1)
    expect(res.high).toBeGreaterThan(res.low)
  })
})
