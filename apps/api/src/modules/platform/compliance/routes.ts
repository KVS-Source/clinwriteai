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
import { buildComplianceReport } from './report/builder.js'
import { renderComplianceReportPdf } from './report/pdf-renderer.js'

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

    const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
    const report = await buildComplianceReport(app.prisma, auditSecret, { from, to }, request.log)

    await app.audit.append({
      timestamp: report.generatedAt,
      actorId: request.user!.id,
      action: 'compliance_report_requested',
      entityType: 'compliance',
      entityId: 'report',
      details: { from: from.toISOString(), to: to.toISOString(), format: 'json' },
      ipAddress: request.ip ?? null,
    })

    return report
  })

  // PDF variant — same builder, pdfkit-rendered. Attestable artefact for
  // auditor binders. Streams application/pdf with a dated filename.
  app.get('/report.pdf', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const q = windowQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const from = q.data.from ? new Date(q.data.from) : defaultFrom
    const to = q.data.to ? new Date(q.data.to) : new Date()

    const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
    const report = await buildComplianceReport(app.prisma, auditSecret, { from, to }, request.log)

    await app.audit.append({
      timestamp: report.generatedAt,
      actorId: request.user!.id,
      action: 'compliance_report_requested',
      entityType: 'compliance',
      entityId: 'report',
      details: { from: from.toISOString(), to: to.toISOString(), format: 'pdf' },
      ipAddress: request.ip ?? null,
    })

    const filename = `compliance-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.pdf`
    reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
    return reply.send(renderComplianceReportPdf(report))
  })

  // --- Audit log export (JSONL) ------------------------------------------
  // SOC 2 CC7.3 / Part 11 §11.10(e) evidence surface: streams the full
  // audit chain (optionally windowed) as JSON Lines. Streaming avoids
  // loading millions of rows into memory for prod-scale exports. JSONL
  // (one object per line) is the universal auditor-tool format.
  //
  // The export is itself audited as 'audit_log_exported' so there's a
  // trail of who pulled evidence when.

  app.get('/audit-events.jsonl', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const q = windowQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const from = q.data.from ? new Date(q.data.from) : new Date(0)
    const to = q.data.to ? new Date(q.data.to) : new Date()

    // Count first for the audit event's details — cheap, uses the same
    // index as the stream below.
    const countRow = await app.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM audit_events WHERE "timestamp" BETWEEN $1 AND $2',
      from, to,
    )
    const rowCount = Number(countRow[0]?.count ?? 0)

    const filename = `audit-events-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.jsonl`
    reply
      .type('application/x-ndjson')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Row-Count', String(rowCount))

    // Fastify streams the async-iterator body directly. We page through
    // rows in chunks of 1000 to keep the memory profile flat regardless
    // of export size.
    async function* iter() {
      const PAGE = 1000
      let cursor: Date = from
      let cursorRow = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await app.prisma.$queryRawUnsafe<Array<{
          id: string
          timestamp: Date
          actorId: string
          action: string
          entityType: string
          entityId: string
          details: unknown
          ipAddress: string | null
          prevHash: string | null
          rowHash: string
        }>>(
          `SELECT id, "timestamp", "actorId", action, "entityType", "entityId", details, "ipAddress", "prevHash", "rowHash"
           FROM audit_events
           WHERE "timestamp" BETWEEN $1 AND $2
           ORDER BY "timestamp" ASC, id ASC
           OFFSET $3 LIMIT $4`,
          from, to, cursorRow, PAGE,
        )
        if (batch.length === 0) break
        for (const row of batch) yield JSON.stringify(row) + '\n'
        cursorRow += batch.length
        if (batch.length < PAGE) break
        void cursor
      }
    }

    // Audit the export BEFORE streaming (the actor needs to be on record
    // even if the stream fails mid-flight). Follow-up write below if the
    // row count or stream status is useful.
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'audit_log_exported',
      entityType: 'compliance',
      entityId: 'audit-events',
      details: {
        from: from.toISOString(),
        to: to.toISOString(),
        rowCount,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.send(iter())
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

  // --- GDPR Art. 17 subject-request anonymisation ------------------------
  //
  // "Right to erasure" — a data subject requests their personal data be
  // removed. We can't hard-delete the User row because historical FKs
  // (publication authors, signatures, audit actors) depend on it; instead
  // we overwrite PII fields with deterministic anonymised placeholders
  // and flip status to 'anonymised'. The audit trail integrity story
  // stays intact — all historical actions still point at a user row,
  // just one that no longer carries personal data.
  //
  // Fields scrubbed:
  //   - email → 'anonymised-<id>@removed.local' (unique, parseable)
  //   - name → 'Anonymised User'
  //   - initials → 'AU'
  //   - ssoSubject → null (breaks SCIM link so the IdP can't rehydrate)
  //   - lastActiveAt → null
  //   - status → 'anonymised' (new terminal state)
  //
  // Side effects:
  //   - Revoke all active sessions (user can no longer log in)
  //   - Scrub mobile/email on any KolContact or MaContact where userId
  //     matches (Module E contact directory also stores PII)
  //
  // What this does NOT do (deliberate):
  //   - Delete historical audit events naming the actor (Part 11 forbids
  //     mutating audit chain; the chain rows just now point at an
  //     anonymised user id — same shape auditors expect)
  //   - Scrub denormalised author names on PublicationAuthor rows (that
  //     would break historical publication records; alternative is to
  //     mark the author row with an 'anonymised: true' flag — scope-later)

  const anonymiseSchema = z.object({
    userId: z.string().min(1),
    reason: z.string().min(1, 'reason required for the audit record'),
    // Confirmation to prevent fat-finger: operator types the user's email.
    confirmEmail: z.string().email(),
  })

  app.post('/gdpr-anonymise', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const parsed = anonymiseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const target = await app.prisma.user.findUnique({ where: { id: parsed.data.userId } })
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.status === 'anonymised') return reply.code(409).send({ error: 'already_anonymised' })
    if (target.email !== parsed.data.confirmEmail) {
      return reply.code(400).send({ error: 'confirm_email_mismatch', message: 'confirmEmail must match the target user\'s current email' })
    }
    // Protect against anonymising the last super-admin — would lock out
    // the entire control plane.
    if (target.role === 'super-admin') {
      const otherSuperAdmins = await app.prisma.user.count({
        where: {
          role: 'super-admin',
          status: 'active',
          id: { not: target.id },
        },
      })
      if (otherSuperAdmins === 0) {
        return reply.code(409).send({
          error: 'last_super_admin',
          message: 'Cannot anonymise the last active super-admin — promote another user first',
        })
      }
    }

    const anonymisedEmail = `anonymised-${target.id}@removed.local`
    const now = new Date()

    const result = await app.prisma.$transaction(async (tx) => {
      // 1. Scrub User row.
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          email: anonymisedEmail,
          name: 'Anonymised User',
          initials: 'AU',
          ssoSubject: null,
          lastActiveAt: null,
          status: 'anonymised',
        },
      })

      // 2. Revoke all active sessions.
      // Session table has no revokeReason column; reason stays in the
      // audit event payload. Rows just get revokedAt set.
      const sessionResult = await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now },
      })

      // 3. Scrub Module E contact directory rows that reference this user
      // by email (contacts can be externals; we match on inviteEmail to
      // catch both).
      const kolResult = await tx.kolContact.updateMany({
        where: { email: target.email },
        data: { email: anonymisedEmail, mobileEncrypted: null, name: 'Anonymised Contact' },
      })
      const maResult = await tx.maContact.updateMany({
        where: { email: target.email },
        data: { email: anonymisedEmail, mobileEncrypted: null, name: 'Anonymised Contact' },
      })

      return {
        userId: updated.id,
        revokedSessions: sessionResult.count,
        kolContactsScrubbed: kolResult.count,
        maContactsScrubbed: maResult.count,
      }
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'gdpr_anonymisation_executed',
      entityType: 'user',
      entityId: target.id,
      details: {
        reason: parsed.data.reason,
        revokedSessions: result.revokedSessions,
        kolContactsScrubbed: result.kolContactsScrubbed,
        maContactsScrubbed: result.maContactsScrubbed,
      },
      ipAddress: request.ip ?? null,
    })

    return result
  })
}
