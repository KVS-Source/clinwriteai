// 72-hour breach notification — Arc 10.3.
//
// DPDPA 2023 §8(6) requires Data Fiduciaries to notify the Data
// Protection Board + each affected Data Principal "in such manner as
// may be prescribed" when a personal data breach occurs. The MeitY
// Draft Rules specify 72 hours.
//
// Design:
//   - `recordBreach()` writes an immutable audit event + enqueues the
//     notification job on `dpdpa.breach_notification`.
//   - The worker (apps/worker/src/jobs/dpdpa-breach-notification.ts
//     in a follow-up) handles the DPB email send + per-DP email.
//   - DPB email endpoint is config-driven (DPDPA_DPB_EMAIL env). The
//     real endpoint is pending publication by the India Data Protection
//     Board; until then operator sets a placeholder + the audit event
//     captures intent even if the send fails.

import type { FastifyInstance } from 'fastify'

export interface BreachRecord {
  tenantId: string
  summary: string                            // 1-sentence operator description
  detectedAt: Date
  affectedSubjectCount: number
  dataCategories: string[]                   // 'email', 'mobile', 'health_data', ...
  rootCause: string
  mitigationTaken: string
  reportedByUserId: string
}

export async function recordBreach(app: FastifyInstance, breach: BreachRecord): Promise<{ auditEventId: string | undefined }> {
  const notificationDeadline = new Date(breach.detectedAt.getTime() + 72 * 60 * 60 * 1000)

  const auditEvent = await app.audit.append({
    timestamp: new Date().toISOString(),
    actorId: breach.reportedByUserId,
    action: 'dpdpa.breach.recorded',
    entityType: 'tenant',
    entityId: breach.tenantId,
    details: {
      summary: breach.summary,
      detectedAt: breach.detectedAt.toISOString(),
      notificationDeadline: notificationDeadline.toISOString(),
      affectedSubjectCount: breach.affectedSubjectCount,
      dataCategories: breach.dataCategories,
      rootCause: breach.rootCause,
      mitigationTaken: breach.mitigationTaken,
    },
    ipAddress: null,
  })

  // Enqueue the notification job. Worker handles the DPB email + per-DP
  // email per the configured DPDPA_DPB_EMAIL endpoint. If the queue
  // isn't registered (dev / test), the audit event alone preserves
  // the intent so the 72h clock is auditable.
  if (app.queue?.enqueue) {
    await app.queue.enqueue('dpdpa.breach_notification', {
      tenantId: breach.tenantId,
      auditEventId: auditEvent?.id,
      detectedAt: breach.detectedAt.toISOString(),
      notificationDeadline: notificationDeadline.toISOString(),
    })
  }

  return { auditEventId: auditEvent?.id }
}
