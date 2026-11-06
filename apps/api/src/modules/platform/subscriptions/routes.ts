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
import { buildSubscriptionView, platformAiTokens } from './usage.js'

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

  // --- The signed-in tenant's view -----------------------------------------
  // ServicesDashboard, SubscriptionPayment, AdminPanel and Reports read their plan and usage from
  // here: the caller's own tenant, real figures, and null where nothing is recorded (usage.ts).
  const subscriptionView: import('fastify').RouteHandlerMethod = async (request) =>
    buildSubscriptionView(app.prisma, request.user!.tenantId ?? null)

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

    // The caller's own tenant's subscription; without one there is nothing to top up.
    const tenantId = request.user!.tenantId ?? null
    const active = tenantId
      ? await app.prisma.subscription.findFirst({ where: { tenantId, endedAt: null }, orderBy: { startedAt: 'desc' } })
      : null
    if (!active) return reply.code(409).send({ error: 'no_active_subscription', message: 'Top-ups need an active subscription.' })
    const requestId = `topup-${Date.now().toString(36)}`
    const requestedAt = new Date().toISOString()

    await app.audit.append({
      timestamp: requestedAt,
      actorId: request.user!.id,
      action: 'subscription_topup_requested',
      entityType: 'subscription',
      entityId: active.id,
      details: { tenantId, requestId, ...parsed.data, gateway: parsed.data.gateway ?? null, status: 'pending_payment' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({ requestId, status: 'pending_payment', requestedAt, ...parsed.data })
  })

  app.get('/services/dashboard',  { preHandler: requireAuth({ roles: ['admin'] }) }, subscriptionView)
  app.get('/admin/subscription',  { preHandler: requireAuth({ roles: ['admin'] }) }, subscriptionView)

  // --- Super-admin dashboard stubs ------------------------------------
  // sPM05: PlatformClient[] + PlatformAnalytics. Both are derived from
  // the Tenant + Subscription + User + Document rows so numbers reflect
  // real DB state (not fake fixtures). Not blocked on external vendors.
  app.get('/super-admin/clients', { preHandler: superAdmin }, async () => {
    const tenants = await app.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } })
    // Each tenant's active plan. Revenue isn't recorded: monthlyCapUsd is the AI spending cap, not a fee.
    const subs = await app.prisma.subscription.findMany({ where: { endedAt: null } })
    const subByTenant = new Map(subs.map(s => [s.tenantId, s]))
    const owners = await app.prisma.membership.findMany({
      where: { role: 'owner' },
      include: { user: { select: { name: true } } },
    })
    const ownerByTenant = new Map(owners.map(o => [o.tenantId, o.user.name]))
    return tenants.map(t => {
      const s = subByTenant.get(t.id)
      return {
        id:               t.id,
        name:             t.name,
        plan:             s?.plan ?? null,
        status:           t.status === 'active' ? 'active' : t.status === 'suspended' ? 'suspended' : 'churned',
        adminContactName: ownerByTenant.get(t.id) ?? null,
        createdAt:        t.createdAt.toISOString(),
        revenueToDateGBP: null,
      }
    })
  })

  app.get('/super-admin/analytics', { preHandler: superAdmin }, async () => {
    const now = new Date()
    const since = new Date(now.getTime() - 30 * 86_400_000)
    const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))
    const [users, projects, docs, tenants, activeSubscriptions, tokens] = await Promise.all([
      app.prisma.user.count({ where: { status: 'active' } }),
      app.prisma.project.count({ where: { status: { not: 'closed' } } }),
      app.prisma.document.count({ where: { createdAt: { gte: since } } }),
      app.prisma.tenant.findMany({ select: { status: true, archivedAt: true } }),
      app.prisma.subscription.count({ where: { endedAt: null } }),
      platformAiTokens(app.prisma, since),
    ])
    const clientCounts = {
      active:    tenants.filter(t => t.status === 'active').length,
      suspended: tenants.filter(t => t.status === 'suspended').length,
      churned:   tenants.filter(t => t.status === 'archived').length,
    }
    return {
      totalActiveUsers:          users,
      activeProjects:            projects,
      documentsCreatedRolling30: docs,
      aiTokensRolling30:         tokens.total,
      // Not all AI use can be tied to a client: a platform admin working outside a client's project.
      aiTokensUnattributedRolling30: tokens.unattributed,
      // Billing isn't connected and no fee is stored (monthlyCapUsd is the AI spending cap), so
      // recurring revenue is unknown rather than estimated.
      mrrGBP:                    null,
      arrGBP:                    null,
      activeSubscriptions,
      churnThisQuarter:          tenants.filter(t => t.archivedAt && t.archivedAt >= quarterStart).length,
      avgTokensPerClientMonth:   clientCounts.active > 0 ? Math.round(tokens.attributed / clientCounts.active) : 0,
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
