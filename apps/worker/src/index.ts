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
import { handleVoiceTranscribe } from './jobs/voice-transcribe.js'
import { handlePresenceReaper } from './jobs/presence-reaper.js'
import { handleAccessReviewCron } from './jobs/access-review-cron.js'

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
  redis: Redis
}
const ctx: JobContext = { prisma, log, redis: connection }

// Map job name → handler. Each handler is invoked with (job, ctx).
const handlers = {
  'med_content.expiry_check': handleMedContentExpiryCheck,
  'ideation.kol_reminder': handleKolReminder,
  'ideation.calendar_overdue': handleCalendarOverdue,
  'compliance.retention_purge': handleRetentionPurge,
  'notification.email': handleNotificationEmail,
  'notification.sms': handleNotificationSms,
  'clinical.restore_version': handleRestoreVersion,
  'clinical.voice_transcribe': handleVoiceTranscribe,
  'clinical.presence_reaper': handlePresenceReaper,
  'compliance.access_review': handleAccessReviewCron,
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
  // Transcription can parallelise safely — each note is independent.
  'clinical.voice_transcribe': 4,
  // Reaper is a single-UPDATE sweep; concurrency=1 avoids racing schedulers.
  'clinical.presence_reaper': 1,
  // Access review is a once-a-month fan-out; concurrency=1 prevents a
  // double-notification race if two schedulers tick at the same minute.
  'compliance.access_review': 1,
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

// --- Health HTTP server ---------------------------------------------------
// Container orchestrators (k8s/compose/systemd) need a probe to decide if
// the worker process is alive. Tiny built-in http.Server avoids pulling
// in Fastify just for this; no external deps. Default port 3002 (API is
// 3001). Set WORKER_HEALTH_PORT=0 to disable.

import { createServer } from 'node:http'
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3002)
const healthServer = healthPort > 0 ? createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      service: 'platform-worker',
      queues: Object.keys(handlers),
      uptime: process.uptime(),
    }))
    return
  }
  if (req.url === '/ready') {
    const started = Date.now()
    const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {}
    async function check<T>(name: string, fn: () => Promise<T>, timeoutMs = 2000): Promise<void> {
      const t0 = Date.now()
      try {
        await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ])
        checks[name] = { ok: true, latencyMs: Date.now() - t0 }
      } catch (err) {
        checks[name] = { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) }
      }
    }
    await check('postgres', async () => { await prisma.$queryRaw`SELECT 1` })
    await check('redis', async () => {
      const r = await connection.ping()
      if (r !== 'PONG') throw new Error(`unexpected ping: ${r}`)
    })
    const allOk = Object.values(checks).every(c => c.ok)
    res.writeHead(allOk ? 200 : 503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ready: allOk, totalMs: Date.now() - started, checks }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found' }))
}) : null

if (healthServer) {
  healthServer.listen(healthPort, () => {
    log.info({ port: healthPort }, 'worker health server listening')
  })
}

// --- Graceful shutdown ----------------------------------------------------

const shutdown = async (signal: NodeJS.Signals) => {
  log.info({ signal }, 'shutting down')
  if (healthServer) await new Promise<void>(resolve => healthServer.close(() => resolve()))
  await Promise.all(workers.map(w => w.close()))
  await connection.quit()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
