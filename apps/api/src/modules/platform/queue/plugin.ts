// Queue Fastify plugin — decorates app.queue + registers cron jobs.
//
// Workers live in a separate process (apps/worker — not part of apps/api).
// This plugin only owns the producer side; the API process never calls
// `.process()` on a Queue.
//
// Resilience: if Redis is unreachable at boot, we still complete plugin
// initialisation so the API can serve non-queue requests. Cron schedule
// registration fires-and-forgets after boot so a cold Redis doesn't block
// Fastify startup past its plugin-timeout window. Observability: enqueues
// will fail with a logged error until Redis recovers; the Phase 6
// `BackupStale` + queue depth alerts catch sustained outages.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { BullMqProducer, createRedisConnection } from './bullmq-producer.js'
import { QueueMetricsScheduler } from './metrics.js'
import type { QueueProducer, QueueJobName } from './producer.js'

const QUEUE_METRICS_TICK_MS = 30_000

// Each cron job is a (name, payload, cron) tuple. Registered idempotently.
const CRON_JOBS: ReadonlyArray<{ name: QueueJobName; cron: string; description: string }> = [
  { name: 'med_content.expiry_check',   cron: '0 2 * * *',  description: 'nightly 02:00 UTC — 60/30-day expiry warnings' },
  { name: 'ideation.kol_reminder',      cron: '15 * * * *', description: 'hourly — KOL review reminder tiers' },
  { name: 'ideation.calendar_overdue',  cron: '30 * * * *', description: 'hourly — flip scheduled → overdue' },
  { name: 'compliance.retention_purge', cron: '0 3 * * *',  description: 'daily 03:00 UTC — Phase 5 retention policy' },
  { name: 'clinical.presence_reaper',   cron: '*/2 * * * *', description: 'every 2 min — close stale presence sessions' },
  { name: 'compliance.access_review',   cron: '30 2 1 * *',  description: 'monthly 1st 02:30 UTC — notify super-admins of access review' },
]

const queuePlugin: FastifyPluginAsync = async (app) => {
  const connection = createRedisConnection(app.env.REDIS_URL)
  const producer = new BullMqProducer(connection)
  app.decorate('queue', producer)
  // Expose the raw Redis connection so /ready can ping it. Also allows
  // other plugins (future rate-limit backend swap, pub/sub bridge) to
  // reuse the single connection pool rather than opening a second one.
  app.decorate('redis', connection)

  // Fire-and-forget cron registration. Blocking on this at boot would
  // couple API startup to Redis availability (BullMQ.add waits for the
  // Redis command to succeed; if Redis is unreachable, it blocks past
  // Fastify's plugin-timeout window). Instead, kick it off asynchronously
  // and log on failure — the Phase 6 QueueBacklogGrowing/failed alerts
  // will catch sustained unavailability.
  void (async () => {
    for (const job of CRON_JOBS) {
      try {
        await producer.schedule(job.name, {}, job.cron)
        app.log.info({ job: job.name, cron: job.cron }, 'cron job registered')
      } catch (err) {
        app.log.error({ job: job.name, cron: job.cron, err }, 'cron registration failed — Redis down?')
      }
    }
  })()

  // Queue metrics scheduler — polls every 30s. tick() handles per-queue
  // failures internally, so a dead Redis just means the gauges stay at 0.
  const metricsScheduler = new QueueMetricsScheduler({
    queues: producer.getQueues(),
    waiting: app.platformMetrics.bullmqQueueWaiting,
    active: app.platformMetrics.bullmqQueueActive,
    failed: app.platformMetrics.bullmqQueueFailed,
    delayed: app.platformMetrics.bullmqQueueDelayed,
    tickMs: QUEUE_METRICS_TICK_MS,
    logger: app.log,
  })
  metricsScheduler.start()

  app.addHook('onClose', async () => {
    metricsScheduler.stop()
    await producer.close()
    await connection.quit()
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    queue: QueueProducer
    redis: import('ioredis').Redis
  }
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['platform-metrics'],
})
