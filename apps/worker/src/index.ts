// BullMQ worker entrypoint. Separate process from apps/api so job
// processing doesn't impact request latency and vice versa.
//
// Each queue gets its own Worker instance so concurrency, metrics, and
// dead-letter handling are per-name.

import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { PrismaClient } from '@prisma/client'
import pino from 'pino'
import { handleMedContentExpiryCheck } from './jobs/med-content-expiry.js'
import { handleKolReminder } from './jobs/kol-reminder.js'
import { handleCalendarOverdue } from './jobs/calendar-overdue.js'
import { handleRetentionPurge } from './jobs/retention-purge.js'
import { handleNotificationEmail, handleNotificationSms } from './jobs/notification-delivery.js'
import { handleRestoreVersion } from './jobs/restore-version.js'

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
})

if (!process.env.REDIS_URL) {
  log.error('REDIS_URL not set — cannot start worker')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  log.error('DATABASE_URL not set — cannot start worker')
  process.exit(1)
}

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
})

const prisma = new PrismaClient()
await prisma.$connect()
log.info('Worker: Prisma connected')

interface JobContext {
  prisma: PrismaClient
  log: typeof log
}
const ctx: JobContext = { prisma, log }

// Map job name → handler. Each handler is invoked with (job, ctx).
const handlers = {
  'med_content.expiry_check': handleMedContentExpiryCheck,
  'ideation.kol_reminder': handleKolReminder,
  'ideation.calendar_overdue': handleCalendarOverdue,
  'compliance.retention_purge': handleRetentionPurge,
  'notification.email': handleNotificationEmail,
  'notification.sms': handleNotificationSms,
  'clinical.restore_version': handleRestoreVersion,
} as const
type JobName = keyof typeof handlers

// Per-queue workers so concurrency is per-name. Values of 1 for the
// cron-driven cleanup jobs (don't want two retention purges racing);
// higher concurrency for notification deliveries.
const concurrency: Record<JobName, number> = {
  'med_content.expiry_check': 1,
  'ideation.kol_reminder': 1,
  'ideation.calendar_overdue': 1,
  'compliance.retention_purge': 1,
  'notification.email': 10,
  'notification.sms': 5,
  // concurrency=1 for restores — avoids racing concurrent version creations
  // for the same document; the audit chain is strictly ordered per-doc.
  'clinical.restore_version': 1,
}

const workers: Worker[] = []
for (const name of Object.keys(handlers) as JobName[]) {
  const w = new Worker(
    name,
    async (job: Job) => {
      const start = Date.now()
      try {
        const result = await handlers[name](job, ctx)
        log.info({ name, jobId: job.id, durationMs: Date.now() - start }, 'job complete')
        return result
      } catch (err) {
        log.error({ name, jobId: job.id, err }, 'job failed')
        throw err  // let BullMQ retry per the default job options
      }
    },
    { connection, concurrency: concurrency[name] },
  )
  w.on('failed', (job, err) => log.warn({ name, jobId: job?.id, err: err?.message }, 'job attempt failed'))
  workers.push(w)
  log.info({ name, concurrency: concurrency[name] }, 'worker started')
}

// --- Graceful shutdown ----------------------------------------------------

const shutdown = async (signal: NodeJS.Signals) => {
  log.info({ signal }, 'shutting down')
  await Promise.all(workers.map(w => w.close()))
  await connection.quit()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
