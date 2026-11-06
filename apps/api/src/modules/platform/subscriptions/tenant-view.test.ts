// /services/dashboard and /admin/subscription show the caller's own tenant: its plan and its real AI
// usage, with nothing invented where no data exists. /super-admin/analytics reports real tokens and
// churn, and leaves revenue unknown because billing isn't connected.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { subscriptionRoutes } from './routes.js'
import { billingPeriod } from './usage.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const THIS_MONTH = new Date()
const LONG_AGO = new Date(Date.now() - 400 * 86_400_000)

const CALLS: Row[] = [
  { tenantId: 'T-A', projectId: 'P-A', module: 'A', inputTokens: 100, outputTokens: 50, costUsd: 1.5, createdAt: THIS_MONTH },
  // A platform admin (no tenant) working in Tenant A's project: still Tenant A's use.
  { tenantId: null, projectId: 'P-A', module: 'B', inputTokens: 30, outputTokens: 20, costUsd: 0.5, createdAt: THIS_MONTH },
  { tenantId: 'T-B', projectId: 'P-B', module: 'A', inputTokens: 900, outputTokens: 100, costUsd: 9, createdAt: THIS_MONTH },
  // Not linked to any client.
  { tenantId: null, projectId: null, module: 'A', inputTokens: 5, outputTokens: 5, costUsd: 0.1, createdAt: THIS_MONTH },
  // Before this period: never counted.
  { tenantId: 'T-A', projectId: 'P-A', module: 'A', inputTokens: 7777, outputTokens: 7777, costUsd: 77, createdAt: LONG_AGO },
]
const PROJECTS = [{ id: 'P-A', tenantId: 'T-A' }, { id: 'P-B', tenantId: 'T-B' }, { id: 'P-X', tenantId: null }]

// The parts of a Prisma where-clause these routes use.
const matches = (c: Row, where: Row): boolean => {
  if (where.createdAt?.gte && c.createdAt < where.createdAt.gte) return false
  if (where.OR && !(where.OR as Row[]).some(w => matches(c, w))) return false
  if ('tenantId' in where) {
    const t = where.tenantId
    if (t && typeof t === 'object' && 'not' in t) { if (c.tenantId === t.not) return false }
    else if (c.tenantId !== t) return false
  }
  if (where.projectId?.in && !where.projectId.in.includes(c.projectId)) return false
  return true
}

async function build(actor: Partial<AuthenticatedUser>, opts: { subs?: Row[]; tenants?: Row[] } = {}) {
  const subs = opts.subs ?? []
  const audit: Row[] = []
  const app = Fastify()
  app.decorate('prisma', {
    tenant: {
      findUnique: vi.fn(async ({ where }: Row) => ({ name: where.id === 'T-A' ? 'Acme Oncology' : 'Beta Pharma' })),
      findMany: vi.fn(async () => opts.tenants ?? []),
    },
    subscription: {
      findFirst: vi.fn(async ({ where }: Row) => subs.find(s => s.tenantId === where.tenantId && s.endedAt == null) ?? null),
      count: vi.fn(async () => subs.filter(s => s.endedAt == null).length),
    },
    project: {
      findMany: vi.fn(async ({ where }: Row) => PROJECTS.filter(p => (typeof where.tenantId === 'string' ? p.tenantId === where.tenantId : p.tenantId !== null))),
      count: vi.fn(async ({ where }: Row) => (where.status?.not === 'closed' ? 3 : 4)),
    },
    user: { count: vi.fn(async () => 9) },
    document: { count: vi.fn(async () => 2) },
    aiCallRecord: {
      groupBy: vi.fn(async ({ where }: Row) => {
        const hit = CALLS.filter(c => matches(c, where))
        return [...new Set(hit.map(c => c.module))].map(module => {
          const rows = hit.filter(c => c.module === module)
          return { module, _sum: {
            inputTokens: rows.reduce((n, c) => n + c.inputTokens, 0),
            outputTokens: rows.reduce((n, c) => n + c.outputTokens, 0),
            costUsd: rows.reduce((n, c) => n + c.costUsd, 0),
          } }
        })
      }),
      aggregate: vi.fn(async ({ where }: Row) => {
        const hit = CALLS.filter(c => matches(c, where))
        return { _sum: { inputTokens: hit.reduce((n, c) => n + c.inputTokens, 0), outputTokens: hit.reduce((n, c) => n + c.outputTokens, 0) } }
      }),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: Row) => { audit.push(e) }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: AuthenticatedUser }).user = { id: 'u-1', email: 'a@x.io', role: 'tenant-admin', capabilities: [], modules: ['A'], tenantId: 'T-A', ...actor } as AuthenticatedUser
  })
  await app.register(subscriptionRoutes)
  await app.ready()
  return { app, audit }
}

const GROWTH_B = { id: 's-b', tenantId: 'T-B', plan: 'growth', monthlyCapUsd: 5000, rolloverDay: 1, endedAt: null }
const STARTER_A = { id: 's-a', tenantId: 'T-A', plan: 'starter', monthlyCapUsd: 200, rolloverDay: 1, endedAt: null }

describe.each(['/services/dashboard', '/admin/subscription'])('GET %s', (url) => {
  it('shows the tenant’s own plan, never another tenant’s', async () => {
    const t = await build({ tenantId: 'T-A' }, { subs: [GROWTH_B, STARTER_A] })
    const body = (await t.app.inject({ url })).json()
    expect(body).toMatchObject({ clientId: 'T-A', clientName: 'Acme Oncology', scope: 'tenant', hasSubscription: true, planName: 'starter', monthlyCapUsd: 200 })
    expect(body.renewalDate).toMatch(/^\d{4}-\d{2}-01$/)
    await t.app.close()
  })

  it('a tenant with no subscription has no plan, even when another tenant does', async () => {
    const t = await build({ tenantId: 'T-A' }, { subs: [GROWTH_B] })
    const body = (await t.app.inject({ url })).json()
    expect(body).toMatchObject({ hasSubscription: false, planName: null, monthlyCapUsd: null, renewalDate: null })
    await t.app.close()
  })

  it('counts this tenant’s usage this period, including platform admins on its projects', async () => {
    const t = await build({ tenantId: 'T-A' })
    const { currentPeriod, moduleBreakdown } = (await t.app.inject({ url })).json()
    expect(currentPeriod.tokensConsumed).toBe(200)        // 150 + 50; not T-B's, nor last year's
    expect(currentPeriod.estimatedSpend).toBe(2)
    expect(moduleBreakdown).toEqual([
      { module: 'A', label: 'Clinical Writing', tokensConsumed: 150, cost: 1.5, pctOfTotal: 75, burnRate: null, status: null },
      { module: 'B', label: 'Scientific Writing', tokensConsumed: 50, cost: 0.5, pctOfTotal: 25, burnRate: null, status: null },
    ])
    await t.app.close()
  })

  it('invents nothing: no fake allowance, fee, card, invoices or savings', async () => {
    const t = await build({ tenantId: 'T-A' }, { subs: [STARTER_A] })
    const body = (await t.app.inject({ url })).json()
    expect(body).toMatchObject({ contractedTokensPerMonth: null, monthlyFee: null, paymentMethod: null, invoices: [], marketValueSavings: null })
    expect(body.currentPeriod.tokensRemaining).toBeNull()
    expect(JSON.stringify(body)).not.toMatch(/client-default|4242|Visa|50000000/)
    await t.app.close()
  })

  it('a platform admin sees usage across all tenants, and no plan', async () => {
    const t = await build({ tenantId: null }, { subs: [GROWTH_B] })
    const body = (await t.app.inject({ url })).json()
    expect(body).toMatchObject({ clientId: 'platform', clientName: null, scope: 'platform', hasSubscription: false, planName: null })
    expect(body.currentPeriod.tokensConsumed).toBe(1210)
    await t.app.close()
  })
})

describe('billing period', () => {
  it('starts on the rollover day, or last month before it', () => {
    const { start, next } = billingPeriod(15, new Date('2026-11-20T10:00:00Z'))
    expect([start.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]).toEqual(['2026-11-15', '2026-12-15'])
    const before = billingPeriod(15, new Date('2026-01-10T10:00:00Z'))
    expect([before.start.toISOString().slice(0, 10), before.next.toISOString().slice(0, 10)]).toEqual(['2025-12-15', '2026-01-15'])
  })
})

describe('POST /admin/subscription/top-up', () => {
  const body = { tokens: 100000, amountUsd: 500, gateway: null }
  it('is recorded against the tenant’s own subscription', async () => {
    const t = await build({ tenantId: 'T-A' }, { subs: [GROWTH_B, STARTER_A] })
    expect((await t.app.inject({ method: 'POST', url: '/admin/subscription/top-up', payload: body })).statusCode).toBe(201)
    expect(t.audit[0]).toMatchObject({ entityId: 's-a', details: { tenantId: 'T-A', status: 'pending_payment' } })
    await t.app.close()
  })
  it.each([['a tenant without a subscription', 'T-A'], ['a platform admin', null]])('is refused for %s', async (_l, tenantId) => {
    const t = await build({ tenantId }, { subs: [GROWTH_B] })
    const res = await t.app.inject({ method: 'POST', url: '/admin/subscription/top-up', payload: body })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('no_active_subscription')
    expect(t.audit).toEqual([])
    await t.app.close()
  })
})

describe('Super Admin', () => {
  const tenants = [
    { id: 'T-A', name: 'A', status: 'active', createdAt: new Date(), archivedAt: null },
    { id: 'T-B', name: 'B', status: 'active', createdAt: new Date(), archivedAt: null },
    { id: 'T-C', name: 'C', status: 'archived', createdAt: new Date(), archivedAt: new Date() },
    { id: 'T-D', name: 'D', status: 'archived', createdAt: new Date(), archivedAt: LONG_AGO },
  ]

  it('analytics report real tokens and churn, and no revenue while billing isn’t connected', async () => {
    const t = await build({ tenantId: null }, { subs: [GROWTH_B], tenants })
    const a = (await t.app.inject({ url: '/super-admin/analytics' })).json()
    expect(a.aiTokensRolling30).toBe(1210)                 // last year's calls excluded
    expect(a.aiTokensUnattributedRolling30).toBe(10)       // linked to no client
    expect(a.avgTokensPerClientMonth).toBe(600)            // 1200 attributed / 2 active clients
    expect(a).toMatchObject({ mrrGBP: null, arrGBP: null, activeSubscriptions: 1, churnThisQuarter: 1, activeProjects: 3 })
    await t.app.close()
  })
})
