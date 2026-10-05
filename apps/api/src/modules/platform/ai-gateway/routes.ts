// AI Gateway routes — admin reporting + a direct-chat endpoint for QA.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { RateLimitedError } from './service.js'

const chatSchema = z.object({
  tenantId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  module: z.enum(['A', 'B', 'C', 'D', 'E', 'platform']),
  intent: z.string().min(1),
  model: z.string().default('claude-sonnet-4-6'),
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

    try {
      const result = await app.aiGateway.chat({
        tenantId: parsed.data.tenantId ?? request.user!.tenantId,
        projectId: parsed.data.projectId ?? null,
        actorId: request.user!.id,
        module: parsed.data.module,
        intent: parsed.data.intent,
        model: parsed.data.model,
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
          model: parsed.data.model,
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
  app.get('/usage', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
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

  // Quota management.
  app.put('/quotas', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
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

  app.get('/quotas/:tenantId', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const row = await app.prisma.aiTenantQuota.findUnique({ where: { tenantId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })
}
