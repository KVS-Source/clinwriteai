// AI Gateway routes — admin reporting + a direct-chat endpoint for QA.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { chooseModel } from '../config/ai-engine-settings.js'
import { requireAuth } from '../../../auth/rbac.js'
import { RateLimitedError } from './service.js'
import { invalidateRateCardCache } from './rate-card.js'

const chatSchema = z.object({
  tenantId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  module: z.enum(['A', 'B', 'C', 'D', 'E', 'platform']),
  intent: z.string().min(1),
  model: z.string().optional(),            // omitted -> the engine saved in Admin Panel -> AI Engine
  prompt: z.string().min(1),
  maxOutputTokens: z.number().int().positive().optional(),
})

const quotaSchema = z.object({
  tenantId: z.string().min(1),
  monthlyCapUsd: z.number().min(0),
  warnAtPct: z.number().int().min(0).max(100).default(80),
  rejectAtPct: z.number().int().min(0).max(100).default(100),
  rolloverDay: z.number().int().min(1).max(28).default(1),
})

export const aiGatewayRoutes: FastifyPluginAsync = async (app) => {
  // Direct chat — feature modules call app.aiGateway.chat() in-process;
  // this route exists for QA + testing + admin diagnostics.
  app.post('/chat', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const model = await chooseModel(app.prisma, parsed.data.model)
    try {
      const result = await app.aiGateway.chat({
        tenantId: parsed.data.tenantId ?? request.user!.tenantId,
        projectId: parsed.data.projectId ?? null,
        actorId: request.user!.id,
        module: parsed.data.module,
        intent: parsed.data.intent,
        model,
        prompt: parsed.data.prompt,
        maxOutputTokens: parsed.data.maxOutputTokens,
      })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'ai_chat_called',
        entityType: 'ai_call',
        entityId: result.recordId,
        details: {
          module: parsed.data.module,
          intent: parsed.data.intent,
          model,
          costUsd: result.costUsd,
          limitDecision: result.limitDecision,
          piiScrubbed: result.piiScrubbed,
          piiCategories: result.piiCategories,
        },
        ipAddress: request.ip ?? null,
      })

      return result
    } catch (err) {
      if (err instanceof RateLimitedError) {
        return reply.code(429).send({ error: 'rate_limited', message: err.message })
      }
      throw err
    }
  })

  // Admin usage summary — rollup by module + tenant for the current month.
  app.get('/usage', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const q = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      tenantId: z.string().optional(),
    }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const where = {
      ...(q.data.from && { createdAt: { gte: new Date(q.data.from) } }),
      ...(q.data.to && { createdAt: { ...(q.data.from && { gte: new Date(q.data.from) }), lte: new Date(q.data.to) } }),
      ...(q.data.tenantId && { tenantId: q.data.tenantId }),
    }

    const [byModule, byDay, total] = await Promise.all([
      app.prisma.aiCallRecord.groupBy({
        by: ['module'],
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      // Daily cost series — Prisma can't group by date directly, so pull
      // the raw rows and roll up server-side for small windows.
      app.prisma.aiCallRecord.findMany({
        where,
        select: { createdAt: true, costUsd: true },
        orderBy: { createdAt: 'asc' },
        take: 10_000,
      }),
      app.prisma.aiCallRecord.aggregate({
        where,
        _sum: { costUsd: true },
        _count: { _all: true },
      }),
    ])

    const dayMap = new Map<string, number>()
    for (const r of byDay) {
      const key = r.createdAt.toISOString().slice(0, 10)
      dayMap.set(key, (dayMap.get(key) ?? 0) + Number(r.costUsd))
    }

    return {
      totalCalls: total._count._all,
      totalCostUsd: Number(total._sum.costUsd ?? 0),
      byModule: byModule.map(m => ({
        module: m.module,
        calls: m._count._all,
        costUsd: Number(m._sum.costUsd ?? 0),
        inputTokens: m._sum.inputTokens ?? 0,
        outputTokens: m._sum.outputTokens ?? 0,
      })),
      byDay: Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, costUsd]) => ({ date, costUsd })),
    }
  })

  // Services dashboard analytics — the six panels at the bottom of
  // /services (daily tokens, intents, model mix, top prompts, top users,
  // hourly distribution). Admin-gated; tenant admins see their tenant's
  // calls only, platform admins (tenantId=null) see all.
  app.get('/usage-analytics', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const q = z.object({
      windowDays: z.coerce.number().int().min(1).max(90).default(30),
    }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const windowDays = q.data.windowDays
    const now        = new Date()
    const since      = new Date(now.getTime() - windowDays * 86_400_000)

    const actor = request.user!
    const tenantScope = actor.tenantId == null ? {} : { tenantId: actor.tenantId }
    const where = { createdAt: { gte: since }, ...tenantScope }

    // One raw pull drives daily + hourly aggregates; the groupBys handle
    // intent / model / user / prompt in their own queries so we don't
    // over-fetch promptText for the daily series.
    const [raw, byIntent, byModel, byUser, byPrompt] = await Promise.all([
      app.prisma.aiCallRecord.findMany({
        where,
        select: { createdAt: true, inputTokens: true, outputTokens: true, cachedTokens: true },
        orderBy: { createdAt: 'asc' },
        take: 50_000,
      }),
      app.prisma.aiCallRecord.groupBy({
        by: ['intent'],
        where,
        _count: { _all: true },
        _sum:   { inputTokens: true, outputTokens: true },
      }),
      app.prisma.aiCallRecord.groupBy({
        by: ['model'],
        where,
        _sum: { inputTokens: true, outputTokens: true },
      }),
      app.prisma.aiCallRecord.groupBy({
        by: ['actorId'],
        where,
        _sum:   { inputTokens: true, outputTokens: true, costUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { costUsd: 'desc' } },
        take: 5,
      }),
      app.prisma.aiCallRecord.groupBy({
        by: ['promptText'],
        where: { ...where, promptText: { not: null } },
        _count: { _all: true },
        _sum:   { inputTokens: true, outputTokens: true },
        orderBy: { _count: { promptText: 'desc' } },
        take: 5,
      }),
    ])

    // --- Daily tokens: 30 (or N) buckets, zero-filled so the chart isn't
    // sparse on quiet days.
    const dayBuckets = new Map<string, number>()
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(now.getTime() - (windowDays - 1 - i) * 86_400_000)
      dayBuckets.set(d.toISOString().slice(0, 10), 0)
    }
    for (const r of raw) {
      const key = r.createdAt.toISOString().slice(0, 10)
      if (dayBuckets.has(key)) {
        dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + r.inputTokens + r.outputTokens - r.cachedTokens)
      }
    }
    const dailyTokens = Array.from(dayBuckets.entries()).map(([date, tokens]) => ({ date, tokens }))

    // --- Hourly distribution: 24 buckets, counts normalised to peak=100
    // so the UI's opacity scale is self-contained.
    const hourlyCounts = new Array<number>(24).fill(0)
    for (const r of raw) {
      const h = r.createdAt.getUTCHours()
      hourlyCounts[h] = (hourlyCounts[h] ?? 0) + 1
    }
    const hourlyPeak = Math.max(...hourlyCounts, 1)
    const hourlyDistribution = hourlyCounts.map(n => Math.round((n / hourlyPeak) * 100))
    const peakHour           = hourlyCounts.indexOf(Math.max(...hourlyCounts))

    // --- Share-of-X helper, rounded + clamped so the five intent rows
    // sum to something close to 100 without over-engineering.
    const totalCalls  = byIntent.reduce((n, r) => n + r._count._all, 0)
    const totalTokens = byModel.reduce((n, r) => n + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0)

    const promptIntents = byIntent
      .map(r => {
        const calls  = r._count._all
        const tokens = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0)
        return {
          label: r.intent,
          value: totalCalls > 0 ? Math.round((calls / totalCalls) * 100) : 0,
          hint:  `${calls.toLocaleString()} call${calls === 1 ? '' : 's'} · ${tokens.toLocaleString()} tokens`,
        }
      })
      .sort((a, b) => b.value - a.value)

    const modelMix = byModel
      .map(r => {
        const tokens = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0)
        return {
          label: r.model,
          value: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
          hint:  `${tokens.toLocaleString()} tokens`,
        }
      })
      .sort((a, b) => b.value - a.value)

    const topPrompts = byPrompt.map(r => {
      const tokens = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0)
      const calls  = r._count._all
      // The DB stores the raw user-typed text; truncate for display so a
      // 400-char custom prompt doesn't blow the panel layout.
      const text = r.promptText ?? ''
      const display = text.length > 80 ? `${text.slice(0, 77)}…` : text
      return {
        label: `"${display}"`,
        hint: `${calls.toLocaleString()} call${calls === 1 ? '' : 's'} · ${tokens.toLocaleString()} tokens`,
      }
    })

    // Resolve actorIds → user names for the Top Users list; one lookup
    // (bounded to 5 rows above).
    const actorIds = byUser.map(u => u.actorId)
    const users = actorIds.length === 0
      ? []
      : await app.prisma.user.findMany({
          where:  { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
    const userById = new Map(users.map(u => [u.id, u]))
    const topUsers = byUser.map(r => {
      const u      = userById.get(r.actorId)
      const tokens = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0)
      const cost   = Number(r._sum.costUsd ?? 0)
      return {
        label: u?.name ?? u?.email ?? r.actorId,
        hint:  `${tokens.toLocaleString()} tokens · $${cost.toFixed(2)}`,
      }
    })

    const totalCost = Number(byUser.reduce((n, u) => n + Number(u._sum.costUsd ?? 0), 0))
    const peakHourLabel = `${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 1) % 24).padStart(2, '0')}:00 UTC`

    return {
      generatedAt: now.toISOString(),
      windowDays,
      totals: {
        calls:  raw.length,
        tokens: totalTokens,
        costUsd: totalCost,
      },
      dailyTokens,
      promptIntents,
      modelMix,
      topPrompts,
      topUsers,
      hourlyDistribution,
      hourlyPeakLabel: peakHourLabel,
    }
  })

  // Quota management.
  app.put('/quotas', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = quotaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.aiTenantQuota.upsert({
      where: { tenantId: parsed.data.tenantId },
      create: {
        tenantId: parsed.data.tenantId,
        monthlyCapUsd: parsed.data.monthlyCapUsd,
        warnAtPct: parsed.data.warnAtPct,
        rejectAtPct: parsed.data.rejectAtPct,
        rolloverDay: parsed.data.rolloverDay,
      },
      update: {
        monthlyCapUsd: parsed.data.monthlyCapUsd,
        warnAtPct: parsed.data.warnAtPct,
        rejectAtPct: parsed.data.rejectAtPct,
        rolloverDay: parsed.data.rolloverDay,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ai_quota_set',
      entityType: 'ai_tenant_quota',
      entityId: row.id,
      details: { tenantId: row.tenantId, cap: Number(row.monthlyCapUsd), warnAt: row.warnAtPct, rejectAt: row.rejectAtPct },
      ipAddress: request.ip ?? null,
    })

    return row
  })

  app.get('/quotas/:tenantId', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const row = await app.prisma.aiTenantQuota.findUnique({ where: { tenantId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  // --- Rate card admin (hot-reload, Phase 4) ------------------------------

  const rateCardCreateSchema = z.object({
    version: z.string().min(1).max(64),            // 'v2', 'v2026-11-01'
    notes: z.string().optional(),
    entries: z.array(z.object({
      model: z.string().min(1),
      inputPer1M: z.number().min(0),
      outputPer1M: z.number().min(0),
      cachedInputPer1M: z.number().min(0),
    })).min(1, 'at least one entry required'),
  })

  app.get('/rate-cards', { preHandler: requireAuth({ roles: ['admin'] }) }, async () => {
    return app.prisma.rateCardVersion.findMany({
      orderBy: { publishedAt: 'desc' },
      include: { _count: { select: { entries: true, aiCallRecords: true } } },
    })
  })

  app.get('/rate-cards/active', { preHandler: requireAuth({ roles: ['admin'] }) }, async (_request, reply) => {
    const row = await app.prisma.rateCardVersion.findFirst({
      where: { isActive: true },
      include: { entries: { orderBy: { model: 'asc' } } },
    })
    if (!row) return reply.code(404).send({ error: 'no_active_card' })
    return row
  })

  app.get('/rate-cards/:versionId', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string }
    const row = await app.prisma.rateCardVersion.findUnique({
      where: { id: versionId },
      include: { entries: { orderBy: { model: 'asc' } } },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.post('/rate-cards', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = rateCardCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Enforce UNIQUE(version) explicitly for a friendlier 409.
    const dup = await app.prisma.rateCardVersion.findUnique({ where: { version: parsed.data.version } })
    if (dup) return reply.code(409).send({ error: 'version_exists', version: parsed.data.version })

    // Publish atomically: deactivate current → create new active → insert
    // entries. Readers see at most one active at a time (DB has no
    // partial-unique index but the tx + the service cache guard it).
    const published = await app.prisma.$transaction(async (tx) => {
      await tx.rateCardVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      })
      const v = await tx.rateCardVersion.create({
        data: {
          version: parsed.data.version,
          publishedBy: request.user!.id,
          isActive: true,
          notes: parsed.data.notes,
        },
      })
      await tx.rateCardEntry.createMany({
        data: parsed.data.entries.map(e => ({
          rateCardVersionId: v.id,
          model: e.model,
          inputPer1M: e.inputPer1M,
          outputPer1M: e.outputPer1M,
          cachedInputPer1M: e.cachedInputPer1M,
        })),
      })
      return v
    })

    // Flush the service's in-process cache so new calls price from the
    // new card on the next AI call, not the next 60-second tick.
    invalidateRateCardCache()

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'rate_card_published',
      entityType: 'rate_card_version',
      entityId: published.id,
      details: { version: published.version, entryCount: parsed.data.entries.length },
      ipAddress: request.ip ?? null,
    })

    const withEntries = await app.prisma.rateCardVersion.findUnique({
      where: { id: published.id },
      include: { entries: { orderBy: { model: 'asc' } } },
    })
    return reply.code(201).send(withEntries)
  })

  app.patch('/rate-cards/:versionId/activate', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string }
    const target = await app.prisma.rateCardVersion.findUnique({ where: { id: versionId } })
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.isActive) return target

    await app.prisma.$transaction(async (tx) => {
      await tx.rateCardVersion.updateMany({ where: { isActive: true }, data: { isActive: false } })
      await tx.rateCardVersion.update({ where: { id: versionId }, data: { isActive: true } })
    })
    invalidateRateCardCache()

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'rate_card_activated',
      entityType: 'rate_card_version',
      entityId: versionId,
      details: { version: target.version },
      ipAddress: request.ip ?? null,
    })

    return app.prisma.rateCardVersion.findUnique({ where: { id: versionId }, include: { entries: true } })
  })
}
