// Phase 5 retention purge — daily.
//
// Policy from docs/compliance/README.md:
//   - audit_events        indefinite  (NEVER purge — Part 11)
//   - document_versions   indefinite
//   - provenance_records  indefinite
//   - section_contents    indefinite (bound to versions)
//   - ai_call_records     7 years
//   - notifications       2 years
//   - sessions            90 days after expiry
//
// NEVER delete from the indefinite tables under any env/config override.
// This handler enforces that by hard-coding the list; the admin
// retention-report endpoint computes dry-run counts.

import type { JobHandler } from './types.js'

const DAYS = 86_400_000

const DEFAULTS = {
  sessionsRetainDays: 90,
  notificationsRetainDays: 730,
  aiCallRetainDays: 2555,  // 7 years
}

export const handleRetentionPurge: JobHandler = async (_job, { prisma, log }) => {
  const now = Date.now()

  // Sessions: delete expired OR revoked rows older than N days past expiry.
  // The expiresAt column is the "end of life" anchor; a session that
  // expired yesterday still has 89 forensic days left under the default.
  const sessionsCutoff = new Date(now - DEFAULTS.sessionsRetainDays * DAYS)
  const sessionResult = await prisma.session.deleteMany({
    where: { expiresAt: { lt: sessionsCutoff } },
  })

  // Notifications: delete rows older than 2 years. We keep dismissed and
  // undismissed alike — the audit trail is in audit_events, not here.
  const notificationsCutoff = new Date(now - DEFAULTS.notificationsRetainDays * DAYS)
  const notifResult = await prisma.notification.deleteMany({
    where: { createdAt: { lt: notificationsCutoff } },
  })

  // AI call records: delete > 7 years. HIPAA minimum necessary +
  // cost auditability + practical storage limits.
  const aiCutoff = new Date(now - DEFAULTS.aiCallRetainDays * DAYS)
  const aiResult = await prisma.aiCallRecord.deleteMany({
    where: { createdAt: { lt: aiCutoff } },
  })

  // No touching audit_events, document_versions, provenance_records, section_contents.
  // The migration-level trigger on audit_events would refuse DELETE anyway;
  // we omit the others as a layer of defence-in-depth code review signal.

  log.info({
    sessions: sessionResult.count,
    notifications: notifResult.count,
    aiCallRecords: aiResult.count,
  }, 'retention purge complete')

  return {
    sessionsDeleted: sessionResult.count,
    notificationsDeleted: notifResult.count,
    aiCallRecordsDeleted: aiResult.count,
  }
}
