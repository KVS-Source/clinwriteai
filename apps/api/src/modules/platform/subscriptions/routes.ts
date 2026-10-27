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
  const superAdmin = requireAuth({ roles: ['admin'] })

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
  // Token top-up request (Subscription screen "Proceed to payment").
  // No payment gateway is integrated yet, so nothing is charged: the request
  // is recorded as pending on the audit chain for collection once a gateway
  // is connected.
  const topUpSchema = z.object({
    tokens:    z.number().int().positive(),
    amountUsd: z.number().nonnegative(),
    gateway:   z.string().min(1).nullable().optional(),
  })
  app.post('/admin/subscription/top-up', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = topUpSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const active = await app.prisma.subscription.findFirst({ where: { endedAt: null }, orderBy: { startedAt: 'desc' } })
    const requestId = `topup-${Date.now().toString(36)}`
    const requestedAt = new Date().toISOString()

    await app.audit.append({
      timestamp: requestedAt,
      actorId: request.user!.id,
      action: 'subscription_topup_requested',
      entityType: 'subscription',
      entityId: active?.id ?? 'none',
      details: { requestId, ...parsed.data, gateway: parsed.data.gateway ?? null, status: 'pending_payment' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({ requestId, status: 'pending_payment', requestedAt, ...parsed.data })
  })

  app.get('/services/dashboard',  { preHandler: requireAuth({ roles: ['admin'] }) }, subStubHandler)
  app.get('/admin/subscription',  { preHandler: requireAuth({ roles: ['admin'] }) }, subStubHandler)

  // --- Super-admin dashboard stubs ------------------------------------
  // sPM05: PlatformClient[] + PlatformAnalytics. Both are derived from
  // the Tenant + Subscription + User + Document rows so numbers reflect
  // real DB state (not fake fixtures). Not blocked on external vendors.
  app.get('/super-admin/clients', { preHandler: superAdmin }, async () => {
    const tenants = await app.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } })
    // Pull all active subs so we can tag each tenant with its plan + a
    // revenue estimate (monthlyCapUsd × months-since-start, capped).
    const subs = await app.prisma.subscription.findMany({ where: { endedAt: null } })
    const subByTenant = new Map(subs.map(s => [s.tenantId, s]))
    const owners = await app.prisma.membership.findMany({
      where: { role: 'owner' },
      include: { user: { select: { name: true } } },
    })
    const ownerByTenant = new Map(owners.map(o => [o.tenantId, o.user.name]))
    const now = Date.now()
    return tenants.map(t => {
      const s = subByTenant.get(t.id)
      const months = s ? Math.max(1, Math.round((now - s.startedAt.getTime()) / (30 * 86_400_000))) : 0
      const revenue = s ? Number(s.monthlyCapUsd ?? 0) * months * 0.78 : 0  // USD→GBP approx
      return {
        id:               t.id,
        name:             t.name,
        plan:             s?.plan ?? 'trial',
        status:           t.status === 'active' ? 'active' : t.status === 'suspended' ? 'suspended' : 'churned',
        adminContactName: ownerByTenant.get(t.id) ?? null,
        createdAt:        t.createdAt.toISOString(),
        revenueToDateGBP: Math.round(revenue),
      }
    })
  })

  app.get('/super-admin/analytics', { preHandler: superAdmin }, async () => {
    const [users, projects, docs, tenants, subs] = await Promise.all([
      app.prisma.user.count({ where: { status: 'active' } }),
      app.prisma.project.count(),
      app.prisma.document.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      }),
      app.prisma.tenant.findMany({ select: { status: true } }),
      app.prisma.subscription.findMany({ where: { endedAt: null }, select: { monthlyCapUsd: true } }),
    ])
    const clientCounts = {
      active:    tenants.filter(t => t.status === 'active').length,
      suspended: tenants.filter(t => t.status === 'suspended').length,
      churned:   tenants.filter(t => t.status === 'archived').length,
    }
    const monthlyGBP = subs.reduce((sum, s) => sum + Number(s.monthlyCapUsd ?? 0) * 0.78, 0)
    return {
      totalActiveUsers:          users,
      activeProjects:            projects,
      documentsCreatedRolling30: docs,
      aiTokensRolling30:         0,                     // real token metric lands with Arc 8.1 AI gateway
      mrrGBP:                    Math.round(monthlyGBP),
      arrGBP:                    Math.round(monthlyGBP * 12),
      churnThisQuarter:          0,
      avgTokensPerClientMonth:   0,
      clientCounts,
    }
  })

  // Rate cards — mirror the ai-gateway /rate-cards GET to the UI's
  // expected /super-admin/rate-cards path so the Rate Card screen loads
  // instead of 404'ing. Rows are shaped to the UI's RateCard: each model
  // entry becomes three per-1M-token rate lines (input / output / cached).
  // The table has no validity window, so validUntil is '' (UI shows '—').
  app.get('/super-admin/rate-cards', { preHandler: superAdmin }, async () => {
    const rows = await app.prisma.rateCardVersion.findMany({
      orderBy: { publishedAt: 'desc' },
      include: { entries: { orderBy: { model: 'asc' } } },
    })
    const publishers = await app.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.publishedBy))] } },
      select: { id: true, name: true },
    })
    const nameById = new Map(publishers.map(u => [u.id, u.name]))
    return rows.map(r => ({
      id:                   r.id,
      version:              r.version,
      label:                `Rate card ${r.version}`,
      status:               r.isActive ? 'active' : 'archived',
      effectiveFrom:        r.publishedAt.toISOString(),
      validUntil:           '',
      archivedAt:           null,
      createdBy:            r.publishedBy,
      createdByName:        nameById.get(r.publishedBy) ?? r.publishedBy,
      isDisruptionRateCard: false,
      ...(r.notes && { note: r.notes }),
      currency:             'USD',
      rates: r.entries.flatMap(e => [
        { module: e.model, serviceType: 'Input tokens',        unit: 'per 1M tokens', rate: Number(e.inputPer1M) },
        { module: e.model, serviceType: 'Output tokens',       unit: 'per 1M tokens', rate: Number(e.outputPer1M) },
        { module: e.model, serviceType: 'Cached input tokens', unit: 'per 1M tokens', rate: Number(e.cachedInputPer1M) },
      ]),
    }))
  })

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
