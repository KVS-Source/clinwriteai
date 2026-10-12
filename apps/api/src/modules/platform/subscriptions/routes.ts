// Subscription admin routes — Arc 8.4.
//
//   GET  /admin/subscriptions                  list all
//   GET  /admin/tenants/:tenantId/subscription active sub for tenant
//   POST /admin/tenants/:tenantId/subscription create (ends previous active)
//   POST /admin/subscriptions/:id/end          end a sub (sets endedAt)
//
// Super-admin only. Creating a new sub for a tenant automatically ends
// their currently-active one (one-active-sub-per-tenant invariant).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const PLANS = ['trial', 'starter', 'growth', 'enterprise'] as const

const createSchema = z.object({
  plan: z.enum(PLANS),
  monthlyCapUsd: z.number().nonnegative(),
  rolloverDay: z.number().int().min(1).max(28).default(1),
  rateCardVersionId: z.string().nullable().optional(),
  notes: z.string().max(1000).optional(),
})

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  const superAdmin = requireAuth({ roles: ['super-admin'] })

  app.get('/admin/subscriptions', { preHandler: superAdmin }, async () => {
    const rows = await app.prisma.subscription.findMany({
      orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
      take: 500,
    })
    return rows
  })

  app.get('/admin/tenants/:tenantId/subscription', { preHandler: superAdmin }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const active = await app.prisma.subscription.findFirst({
      where: { tenantId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    })
    if (!active) return reply.code(404).send({ error: 'no_active_subscription' })
    return active
  })

  app.post('/admin/tenants/:tenantId/subscription', { preHandler: superAdmin }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return reply.code(404).send({ error: 'tenant_not_found' })

    const now = new Date()
    // One active sub per tenant — end any prior active first.
    await app.prisma.subscription.updateMany({
      where: { tenantId, endedAt: null },
      data: { endedAt: now },
    })

    const created = await app.prisma.subscription.create({
      data: {
        tenantId,
        plan: parsed.data.plan,
        monthlyCapUsd: parsed.data.monthlyCapUsd,
        rolloverDay: parsed.data.rolloverDay,
        rateCardVersionId: parsed.data.rateCardVersionId ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'subscription.create',
      entityType: 'subscription',
      entityId: created.id,
      details: {
        tenantId,
        plan: parsed.data.plan,
        monthlyCapUsd: parsed.data.monthlyCapUsd,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // --- UI-shape stubs ---------------------------------------------------
  // ServicesDashboard + SubscriptionPayment screens call
  //   GET /services/dashboard  → full Subscription shape
  //   GET /admin/subscription  → full Subscription shape
  // Both are derived from the first active Subscription row (or a
  // deterministic placeholder if no row exists). This keeps the screens
  // out of the "Loading…" infinite state while the real billing pipeline
  // + rate-card wiring is deferred (project_phase_4_deferrals).
  const stubSubscription = (plan = 'growth', monthlyCapUsd = 50000) => {
    const now = new Date()
    const renewal = new Date(now)
    renewal.setMonth(renewal.getMonth() + 1)
    return {
      clientId:                 'client-default',
      planName:                 plan,
      contractedTokensPerMonth: 50_000_000,
      currency:                 'USD',
      monthlyFee:               monthlyCapUsd,
      renewalDate:              renewal.toISOString().slice(0, 10),
      autoRenew:                true,
      currentMonthRunningTotal: 12_430,
      paymentMethod: { type: 'card', brand: 'Visa', last4: '4242', expiryMonth: 12, expiryYear: 2028 },
      activeGateways: ['Anthropic'],
      currentPeriod: {
        month: now.toISOString().slice(0, 7),
        tokensConsumed:  13_200_000,
        tokensRemaining: 36_800_000,
        estimatedSpend:  12_430,
        burnRatePerDay:  420,
        projectedEndOfMonth: 24_000,
      },
      moduleBreakdown: [],
      invoices: [],
      marketValueSavings: {
        total: 0,
        calculatedAt: now.toISOString(),
        rateCardVersion: 'v1.0',
        rateCardSetBy: 'platform',
        rateCardEffectiveDate: now.toISOString().slice(0, 10),
        breakdown: [],
      },
      stub: true,
    }
  }

  const subStubHandler: import('fastify').RouteHandlerMethod = async () => {
    const active = await app.prisma.subscription.findFirst({
      where: { endedAt: null },
      orderBy: { startedAt: 'desc' },
    })
    if (!active) return stubSubscription()
    return stubSubscription(active.plan, Number(active.monthlyCapUsd ?? 50000))
  }
  app.get('/services/dashboard',  { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, subStubHandler)
  app.get('/admin/subscription',  { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, subStubHandler)

  app.post('/admin/subscriptions/:id/end', { preHandler: superAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.subscription.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.endedAt) return reply.code(409).send({ error: 'already_ended' })

    const updated = await app.prisma.subscription.update({
      where: { id },
      data: { endedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'subscription.end',
      entityType: 'subscription',
      entityId: id,
      details: { tenantId: existing.tenantId, plan: existing.plan },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
