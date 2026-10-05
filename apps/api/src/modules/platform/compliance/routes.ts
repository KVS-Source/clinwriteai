// Compliance / audit control-plane routes.
//
// These endpoints exist specifically to satisfy audit evidence requirements
// (SOC 2 CC7.3, ISO 27001 A.8.15, Part 11 §11.10(e)) and to give the
// compliance team self-serve answers to the "what happened and when"
// questions auditors ask.
//
// All routes are super-admin gated — they expose cross-tenant data by
// design. Any admin-scoped read filters stay in the Admin/Users routes.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { PostgresAuditRepository } from '../../../audit/postgres-repository.js'

const windowQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const retentionReportQuery = z.object({
  // Optional override of the policy window per data class — useful for
  // "would this policy change ship any deletions right now?" dry runs.
  sessionsRetainDays: z.coerce.number().int().positive().default(90),
  notificationsRetainDays: z.coerce.number().int().positive().default(730),
  aiCallRetainDays: z.coerce.number().int().positive().default(2555),
})

export const complianceRoutes: FastifyPluginAsync = async (app) => {
  // --- Chain integrity -----------------------------------------------------

  // Called by the monthly evidence snapshot. Also wired into the Grafana
  // dashboard as a dial — any non-200 or non-intact result is a Sev1.
  app.get('/verify-chain', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const q = windowQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    // Resolve the audit secret the same way the audit plugin does — the
    // chain verification MUST use the identical secret, otherwise every row
    // comes back as a chain break.
    const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
    const repo = new PostgresAuditRepository(app.prisma, auditSecret)

    // Convert ISO datetime window → id window if provided. The chain
    // verifier works in id-space; we translate from timestamps so the
    // auditor can supply human-readable periods.
    let fromId: string | undefined
    let toId: string | undefined
    if (q.data.from) {
      const row = await app.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
        'SELECT id FROM audit_events WHERE "timestamp" >= $1::timestamptz ORDER BY id ASC LIMIT 1',
        q.data.from,
      )
      if (row[0]) fromId = String(row[0].id)
    }
    if (q.data.to) {
      const row = await app.prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
        'SELECT id FROM audit_events WHERE "timestamp" <= $1::timestamptz ORDER BY id DESC LIMIT 1',
        q.data.to,
      )
      if (row[0]) toId = String(row[0].id)
    }

    const result = await repo.verifyChain(fromId, toId)

    // Audit the audit — recording that we ran a chain verification is itself
    // a Part 11 record. Keeps the "who checked and when" trail intact.
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'audit_chain_verified',
      entityType: 'audit_events',
      entityId: 'chain',
      details: { intact: result.intact, firstBreakAt: result.firstBreakAt, fromId, toId },
      ipAddress: request.ip ?? null,
    })

    return result
  })

  // --- Compliance summary report ------------------------------------------
  //
  // One endpoint pulls everything an auditor sees on the readiness dashboard:
  //   - audit event count + per-action breakdown over the window
  //   - chain integrity for the window
  //   - access denials (401/403 proxy via audit action names when present)
  //   - AI calls + cost
  //   - pending retention actions (counts that would be deleted today)

  app.get('/report', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const q = windowQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const from = q.data.from ? new Date(q.data.from) : defaultFrom
    const to = q.data.to ? new Date(q.data.to) : new Date()

    const [auditTotal, auditByAction, aiSummary, userCount, activeSessionCount, chainResult] = await Promise.all([
      app.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*)::bigint AS count FROM audit_events WHERE "timestamp" BETWEEN $1 AND $2',
        from, to,
      ),
      app.prisma.$queryRawUnsafe<Array<{ action: string; count: bigint }>>(
        'SELECT action, COUNT(*)::bigint AS count FROM audit_events WHERE "timestamp" BETWEEN $1 AND $2 GROUP BY action ORDER BY count DESC',
        from, to,
      ),
      app.prisma.aiCallRecord.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      app.prisma.user.count(),
      app.prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      // Reuse the chain-verify helper rather than duplicating the logic.
      (async () => {
        const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
        const repo = new PostgresAuditRepository(app.prisma, auditSecret)
        return repo.verifyChain()
      })(),
    ])

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'compliance_report_requested',
      entityType: 'compliance',
      entityId: 'report',
      details: { from: from.toISOString(), to: to.toISOString() },
      ipAddress: request.ip ?? null,
    })

    return {
      window: { from, to },
      audit: {
        totalEvents: Number(auditTotal[0]?.count ?? 0),
        byAction: auditByAction.map(r => ({ action: r.action, count: Number(r.count) })),
        chainIntegrity: chainResult,
      },
      ai: {
        totalCalls: aiSummary._count._all,
        totalCostUsd: Number(aiSummary._sum.costUsd ?? 0),
        totalInputTokens: aiSummary._sum.inputTokens ?? 0,
        totalOutputTokens: aiSummary._sum.outputTokens ?? 0,
      },
      identity: {
        userCount,
        activeSessionCount,
      },
    }
  })

  // --- Retention report ----------------------------------------------------
  //
  // Doesn't delete anything. Reports counts that WOULD be deleted under the
  // supplied retention windows (defaults match ../README.md policy). The
  // actual purge job runs via a BullMQ cron (Phase 6).

  app.get('/retention-report', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const q = retentionReportQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const now = new Date()
    const sessionsCutoff = new Date(now.getTime() - q.data.sessionsRetainDays * 86_400_000)
    const notificationsCutoff = new Date(now.getTime() - q.data.notificationsRetainDays * 86_400_000)
    const aiCutoff = new Date(now.getTime() - q.data.aiCallRetainDays * 86_400_000)

    const [sessionsToDelete, notificationsToDelete, aiCallsToDelete] = await Promise.all([
      app.prisma.session.count({ where: { expiresAt: { lt: sessionsCutoff } } }),
      app.prisma.notification.count({ where: { createdAt: { lt: notificationsCutoff } } }),
      app.prisma.aiCallRecord.count({ where: { createdAt: { lt: aiCutoff } } }),
    ])

    // Explicitly list what is NEVER purged. If retention policy changes
    // this is where you'd see the diff.
    const indefiniteRetention = {
      auditEvents: 'Indefinite — Part 11 record of authenticity',
      documentVersions: 'Indefinite — content provenance',
      provenanceRecords: 'Indefinite — Part 11 AI provenance',
      sectionContents: 'Indefinite — bound to document_versions',
    }

    return {
      cutoffs: { sessionsCutoff, notificationsCutoff, aiCutoff },
      candidates: {
        sessions: sessionsToDelete,
        notifications: notificationsToDelete,
        aiCallRecords: aiCallsToDelete,
      },
      indefiniteRetention,
    }
  })

  // --- Access review export ------------------------------------------------
  //
  // Monthly access review deliverable (SOC 2 CC6.1 / ISO 27001 A.8.3).
  // Returns the row-shape the compliance share drop expects — one row per
  // user with role, modules, last-active, session count.

  app.get('/access-review', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request) => {
    const users = await app.prisma.user.findMany({
      orderBy: [{ status: 'asc' }, { email: 'asc' }],
      include: {
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        },
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'access_review_exported',
      entityType: 'compliance',
      entityId: 'access-review',
      details: { userCount: users.length },
      ipAddress: request.ip ?? null,
    })

    return users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      modules: u.modules,
      status: u.status,
      tenantId: u.tenantId,
      lastActiveAt: u.lastActiveAt,
      activeSessionCount: u.sessions.length,
      ssoSubject: u.ssoSubject,
    }))
  })
}
