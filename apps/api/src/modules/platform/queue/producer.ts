// QueueProducer — cloud-portable interface (ADR 0008 + 0007).
//
// Feature code enqueues jobs via `app.queue.enqueue(name, payload, opts?)`.
// The default implementation is BullMQ-on-Redis; year-2 AWS migration swaps
// in an SQS-backed producer. The interface stays identical so no feature
// code changes.
//
// Jobs we need to schedule (from the deferral memories):
//   - notification.email + notification.sms      (Phase 4 Batch 2)
//   - med_content.expiry_check                   (Phase 3C deferred cron)
//   - ideation.kol_reminder                      (Phase 3E deferred cron)
//   - ideation.calendar_overdue                  (Phase 3E deferred cron)
//   - compliance.retention_purge                 (Phase 5 deferred cron)
//
// Each job name is a dotted string. Payloads are plain JSON — no class
// instances; the worker reconstructs any domain object from the ids.

export type QueueJobName =
  | 'notification.email'
  | 'notification.sms'
  | 'med_content.expiry_check'
  | 'ideation.kol_reminder'
  | 'ideation.calendar_overdue'
  | 'compliance.retention_purge'
  | 'clinical.restore_version'
  | 'clinical.voice_transcribe'
  | 'clinical.presence_reaper'
  | 'compliance.access_review'

export interface QueueJobOptions {
  /** Delay in milliseconds before the worker picks the job up. */
  delayMs?: number
  /** Attempts before dead-lettering. Default: 3 with exponential back-off. */
  attempts?: number
  /** Idempotency key — jobs with same (name, jobId) are deduped. */
  jobId?: string
  /** Cron spec for repeatable jobs. When set, delayMs is ignored. */
  cron?: string
}

export interface QueueProducer {
  enqueue<P>(name: QueueJobName, payload: P, opts?: QueueJobOptions): Promise<{ jobId: string }>
  /** Register a repeating job (idempotent). Called once at boot. */
  schedule<P>(name: QueueJobName, payload: P, cron: string): Promise<void>
  /** Teardown — called from onClose. */
  close(): Promise<void>
}
