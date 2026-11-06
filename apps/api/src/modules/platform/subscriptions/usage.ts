// The signed-in tenant's subscription and AI usage, for /services/dashboard and /admin/subscription.
//
// Real, and scoped to the caller's tenant:
//   plan, monthly AI cost cap, renewal   — their active Subscription row (null when they have none)
//   tokens, AI cost, burn, per-module    — AiCallRecord since the start of the billing period
// A platform admin has no tenant: they see usage across all tenants and no plan.
//
// Nothing stores a contracted token allowance, a fee, a payment method or invoices yet, so those are
// null / empty rather than made up. monthlyCapUsd is the AI spending cap, not what the client pays.

import type { Prisma, PrismaClient } from '@prisma/client'

const DAY_MS = 86_400_000

const MODULE_LABELS: Record<string, string> = {
  A: 'Clinical Writing', B: 'Scientific Writing', C: 'Medical Writing', D: 'Regulatory Writing', E: 'Ideation & Publishing', platform: 'Platform',
}

/**
 * Which AI calls belong to a tenant: those recorded against it, plus those with no tenant made on one
 * of its projects. A platform admin working in a client's project is recorded with no tenant, and that
 * use still belongs to the client. `null` = every tenant (platform admin).
 */
export async function aiUsageScope(prisma: PrismaClient, tenantId: string | null): Promise<Prisma.AiCallRecordWhereInput> {
  if (tenantId == null) return {}
  const projects = await prisma.project.findMany({ where: { tenantId }, select: { id: true } })
  return { OR: [{ tenantId }, { tenantId: null, projectId: { in: projects.map(p => p.id) } }] }
}

/** The billing period containing `now`: it starts on the rollover day (UTC), and the next one a month later. */
export function billingPeriod(rolloverDay: number, now: Date): { start: Date; next: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), rolloverDay))
  if (now.getUTCDate() < rolloverDay) start.setUTCMonth(start.getUTCMonth() - 1)
  const next = new Date(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { start, next }
}

const money = (n: number) => Math.round(n * 100) / 100

export async function buildSubscriptionView(prisma: PrismaClient, tenantId: string | null, now: Date = new Date()) {
  const [tenant, sub, scope] = await Promise.all([
    tenantId ? prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }) : null,
    tenantId ? prisma.subscription.findFirst({ where: { tenantId, endedAt: null }, orderBy: { startedAt: 'desc' } }) : null,
    aiUsageScope(prisma, tenantId),
  ])

  const { start, next } = billingPeriod(sub?.rolloverDay ?? 1, now)
  const rows = await prisma.aiCallRecord.groupBy({
    by: ['module'],
    where: { ...scope, createdAt: { gte: start } },
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
  })
  const perModule = rows.map(r => ({
    module: r.module,
    tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
    cost: Number(r._sum.costUsd ?? 0),
  })).sort((a, b) => b.tokens - a.tokens)
  const tokensConsumed = perModule.reduce((n, r) => n + r.tokens, 0)
  const cost = perModule.reduce((n, r) => n + r.cost, 0)

  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / DAY_MS))
  const daysInPeriod = Math.round((next.getTime() - start.getTime()) / DAY_MS)
  const burnRatePerDay = cost / daysElapsed

  return {
    clientId:                 tenantId ?? 'platform',
    clientName:               tenant?.name ?? null,
    scope:                    tenantId ? 'tenant' as const : 'platform' as const,
    hasSubscription:          !!sub,
    planName:                 sub?.plan ?? null,
    monthlyCapUsd:            sub ? Number(sub.monthlyCapUsd) : null,
    renewalDate:              sub ? next.toISOString().slice(0, 10) : null,
    contractedTokensPerMonth: null,
    monthlyFee:               null,
    paymentMethod:            null,
    autoRenew:                false,
    currency:                 'USD',
    activeGateways:           [] as string[],
    currentPeriod: {
      month:               start.toISOString().slice(0, 7),
      tokensConsumed,
      tokensRemaining:     null,
      estimatedSpend:      money(cost),
      burnRatePerDay:      money(burnRatePerDay),
      projectedEndOfMonth: money(burnRatePerDay * daysInPeriod),
    },
    // Burn rate and status compare against an allowance, which isn't recorded per module.
    moduleBreakdown: perModule.map(r => ({
      module:         r.module,
      label:          MODULE_LABELS[r.module] ?? r.module,
      tokensConsumed: r.tokens,
      cost:           money(r.cost),
      pctOfTotal:     tokensConsumed > 0 ? Math.round((r.tokens / tokensConsumed) * 100) : 0,
      burnRate:       null,
      status:         null,
    })),
    invoices:           [] as never[],
    marketValueSavings: null,
  }
}

/** Platform-wide AI tokens in the window, split into those linked to a client and those that aren't. */
export async function platformAiTokens(prisma: PrismaClient, since: Date) {
  const clientProjects = await prisma.project.findMany({ where: { tenantId: { not: null } }, select: { id: true } })
  const sum = (where: Prisma.AiCallRecordWhereInput) =>
    prisma.aiCallRecord.aggregate({ where: { ...where, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } })
      .then(a => (a._sum.inputTokens ?? 0) + (a._sum.outputTokens ?? 0))
  const [total, attributed] = await Promise.all([
    sum({}),
    sum({ OR: [{ tenantId: { not: null } }, { projectId: { in: clientProjects.map(p => p.id) } }] }),
  ])
  return { total, attributed, unattributed: total - attributed }
}
