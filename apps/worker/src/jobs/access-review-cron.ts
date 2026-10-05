// Monthly access review cron — Phase 5 operational task.
//
// Produces the same user snapshot as GET /admin/compliance/access-review
// and notifies every super-admin so compliance has a monthly nudge.
//
// Scheduled: 1st of each month at 02:30 UTC (after retention purge).
// Concurrency=1 to avoid duplicate notifications.
//
// What this does NOT do (follow-ups):
//   - Write an `access_review_exported` audit event. Workers don't share
//     the API's AuditRepository (hash-chain append needs AUDIT_HASH_SECRET
//     + the chain row-hash computation). Extracting that into a shared
//     package is pre-work for cross-service audit; until then, super-admins
//     clicking into /admin/compliance/access-review via the notification
//     link writes the audit event through the REST path and keeps the
//     `platform_access_review_last_export_seconds` gauge fresh.
//   - Email the compliance distribution list. In-app notification only
//     until the SES/SendGrid adapter is procured.

import type { JobHandler } from './types.js'
import { createHash } from 'node:crypto'

export const handleAccessReviewCron: JobHandler = async (_job, { prisma, log }) => {
  const users = await prisma.user.findMany({
    orderBy: [{ status: 'asc' }, { email: 'asc' }],
    include: {
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      },
    },
  })

  const activeCount = users.filter(u => u.status === 'active').length
  const inactiveCount = users.length - activeCount
  const withSessionsCount = users.filter(u => u.sessions.length > 0).length

  // Hash the sorted user id list so compliance can later prove the
  // snapshot matched a specific population — same shape as the
  // audit-chain integrity story (sha256 over sorted ids).
  const digest = createHash('sha256')
  for (const u of users) digest.update(u.id, 'utf8')
  const snapshotHash = digest.digest('hex')

  const superAdmins = await prisma.user.findMany({
    where: { role: 'super-admin', status: 'active' },
    select: { id: true },
  })

  const payload = {
    userCount: users.length,
    activeCount,
    inactiveCount,
    withSessionsCount,
    snapshotHash,
    source: 'monthly_cron',
  }

  for (const admin of superAdmins) {
    await prisma.notification.create({
      data: {
        recipientId: admin.id,
        kind: 'access_review_ready',
        severity: 'info',
        title: 'Monthly access review ready',
        body: `Access review for ${users.length} user(s) — ${activeCount} active, ${inactiveCount} inactive, ${withSessionsCount} with active sessions. Open /admin/compliance/access-review to download the attested JSON.`,
        linkPath: '/admin/compliance/access-review',
        channels: ['in_app'],
        payload: payload as unknown as object,
      },
    })
  }

  log.info({
    userCount: users.length,
    activeCount,
    inactiveCount,
    notified: superAdmins.length,
    snapshotHash: snapshotHash.slice(0, 12),
  }, 'access review cron complete')

  return {
    userCount: users.length,
    notifiedSuperAdmins: superAdmins.length,
    snapshotHash,
  }
}
