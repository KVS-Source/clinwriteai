// Reports / analytics service (Phase 4).
//
// Read-side aggregation layer. No new tables — all four reports pull
// from existing module tables using Prisma groupBy + count + sum.
//
// Routes:
//   GET /reports/projects/:projectId/dashboard   — per-project rollup
//   GET /reports/tenant/overview                 — org-wide (admin)
//   GET /reports/ai-spend                        — AI cost by module/model
//   GET /reports/audit-activity                  — audit event histogram
//
// Date filters are ISO 8601 (?from=&to=); default is "last 30 days" if
// unset. We never return raw PII — all actor fields are IDs, not names.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Group histograms by day/week/month; default day.
  bucket: z.enum(['day', 'week', 'month']).default('day'),
})

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function resolveRange(input: z.infer<typeof dateRangeSchema>): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date()
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - THIRTY_DAYS_MS)
  return { from, to }
}

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  // --- Project dashboard --------------------------------------------------

  app.get('/reports/projects/:projectId/dashboard', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'not_found' })

    // Documents by status
    const docsByStatus = await app.prisma.document.groupBy({
      by: ['status'],
      where: { projectId, deletedAt: null },
      _count: { _all: true },
    })

    // Publications by status + stage
    const pubsByStatus = await app.prisma.publication.groupBy({
      by: ['status'],
      where: { projectId, deletedAt: null },
      _count: { _all: true },
    })
    const pubsByStage = await app.prisma.publication.groupBy({
      by: ['stage'],
      where: { projectId, deletedAt: null },
      _count: { _all: true },
    })

    // Submissions by stage
    const subsByStage = await app.prisma.regulatorySubmission.groupBy({
      by: ['stage'],
      where: { projectId },
      _count: { _all: true },
    })

    // Med content by status (Module C)
    const medByStatus = await app.prisma.medContentItem.groupBy({
      by: ['status'],
      where: { projectId, archivedAt: null },
      _count: { _all: true },
    })

    // Ideation cards (Module E) — content cards derived via artefact → project
    const cardsByStatus = await app.prisma.ideationContentCard.groupBy({
      by: ['overallStatus'],
      where: {
        artefact: { ideationProject: { projectId } },
      },
      _count: { _all: true },
    })

    // Comments open count (Module A — the thing CRM gates on)
    const openComments = await app.prisma.comment.count({
      where: { document: { projectId }, status: 'open' },
    })

    return {
      project: {
        id: project.id,
        name: project.name,
        therapeuticArea: project.therapeuticArea,
      },
      moduleA: {
        documentsByStatus: Object.fromEntries(docsByStatus.map(r => [r.status, r._count._all])),
        openComments,
      },
      moduleB: {
        publicationsByStatus: Object.fromEntries(pubsByStatus.map(r => [r.status, r._count._all])),
        publicationsByStage: Object.fromEntries(pubsByStage.map(r => [r.stage, r._count._all])),
      },
      moduleC: {
        medContentByStatus: Object.fromEntries(medByStatus.map(r => [r.status, r._count._all])),
      },
      moduleD: {
        submissionsByStage: Object.fromEntries(subsByStage.map(r => [String(r.stage), r._count._all])),
      },
      moduleE: {
        cardsByOverallStatus: Object.fromEntries(cardsByStatus.map(r => [r.overallStatus, r._count._all])),
      },
      generatedAt: new Date().toISOString(),
    }
  })

  // --- Tenant overview (admin) --------------------------------------------

  app.get('/reports/tenant/overview', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async () => {
    // Rollup counts across the whole tenant. Expensive-ish but cached by
    // the client; a materialised view would be the Phase 5+ optimisation.
    const [
      projectCount,
      docCount,
      pubCount,
      subCount,
      medCount,
      ideationCardCount,
      activeUserCount,
      aiCostResult,
    ] = await Promise.all([
      app.prisma.project.count(),
      app.prisma.document.count({ where: { deletedAt: null } }),
      app.prisma.publication.count({ where: { deletedAt: null } }),
      app.prisma.regulatorySubmission.count(),
      app.prisma.medContentItem.count({ where: { archivedAt: null } }),
      app.prisma.ideationContentCard.count(),
      app.prisma.user.count({ where: { status: 'active' } }),
      app.prisma.aiCallRecord.aggregate({ _sum: { costUsd: true } }),
    ])

    const aiCostUsd = aiCostResult._sum.costUsd ?? 0

    return {
      projects: projectCount,
      documents: docCount,
      publications: pubCount,
      submissions: subCount,
      medContent: medCount,
      ideationCards: ideationCardCount,
      activeUsers: activeUserCount,
      aiCostUsdTotal: Number(aiCostUsd),
      generatedAt: new Date().toISOString(),
    }
  })

  // --- AI spend report ----------------------------------------------------

  app.get('/reports/ai-spend', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const parsed = dateRangeSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { from, to } = resolveRange(parsed.data)

    // Spend by (module, model) over the range.
    const byModuleModel = await app.prisma.aiCallRecord.groupBy({
      by: ['module', 'model'],
      where: { createdAt: { gte: from, lte: to } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true, cachedTokens: true },
      _count: { _all: true },
    })

    // Rejections (quota rejects) by module.
    const rejects = await app.prisma.aiCallRecord.groupBy({
      by: ['module'],
      where: {
        createdAt: { gte: from, lte: to },
        limitDecision: 'rejected',
      },
      _count: { _all: true },
    })
    const rejectsByModule = Object.fromEntries(rejects.map(r => [r.module, r._count._all]))

    const totalCostUsd = byModuleModel.reduce((acc, r) => acc + Number(r._sum.costUsd ?? 0), 0)

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totalCostUsd,
      rows: byModuleModel.map(r => ({
        module: r.module,
        model: r.model,
        callCount: r._count._all,
        costUsd: Number(r._sum.costUsd ?? 0),
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        cachedTokens: r._sum.cachedTokens ?? 0,
      })),
      rejectsByModule,
      generatedAt: new Date().toISOString(),
    }
  })

  // --- Audit activity histogram -------------------------------------------

  app.get('/reports/audit-activity', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const parsed = dateRangeSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { from, to } = resolveRange(parsed.data)
    const bucket = parsed.data.bucket

    // Use date_trunc for the time bucket; counts by action within each bucket.
    // Raw SQL because Prisma's groupBy can't do date_trunc on a timestamp.
    const trunc = bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day'
    const rows = await app.prisma.$queryRawUnsafe<Array<{ bucket: Date; action: string; count: bigint }>>(`
      SELECT date_trunc('${trunc}', "timestamp") AS bucket,
             "action",
             COUNT(*)::bigint AS count
      FROM audit_events
      WHERE "timestamp" >= $1 AND "timestamp" <= $2
      GROUP BY bucket, "action"
      ORDER BY bucket ASC, "action" ASC
    `, from, to)

    // Pivot into { bucket: { action: count } } for easier client charting.
    const pivot: Record<string, Record<string, number>> = {}
    const actionsSeen = new Set<string>()
    for (const r of rows) {
      const b = r.bucket.toISOString()
      actionsSeen.add(r.action)
      ;(pivot[b] ??= {})[r.action] = Number(r.count)
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      bucket,
      actions: Array.from(actionsSeen).sort(),
      histogram: pivot,
      generatedAt: new Date().toISOString(),
    }
  })
}
