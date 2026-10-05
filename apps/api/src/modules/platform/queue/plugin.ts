// Queue Fastify plugin — decorates app.queue + registers cron jobs.
//
// Workers live in a separate process (apps/worker — not part of apps/api).
// This plugin only owns the producer side; the API process never calls
// `.process()` on a Queue.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { BullMqProducer, createRedisConnection } from './bullmq-producer.js'
import { QueueMetricsScheduler } from './metrics.js'
import type { QueueProducer } from './producer.js'

const QUEUE_METRICS_TICK_MS = 30_000  // every 30s so alert windows evaluate fast enough

const queuePlugin: FastifyPluginAsync = async (app) => {
  const connection = createRedisConnection(app.env.REDIS_URL)
  const producer = new BullMqProducer(connection)
  app.decorate('queue', producer)

  // --- Repeatable job registration (idempotent on repeat ids) ------------
  // These schedules match the SLOs/runbooks in docs/launch/slo.md + the
  // retention policy in docs/compliance/README.md.
  //
  // Content expiry check — nightly 02:00 UTC. Fires 60/30-day warning
  // notifications per FR-C-xxx (Module C) + content-expiry-scheduler
  // deferral in Phase 3C memory.
  await producer.schedule('med_content.expiry_check', {}, '0 2 * * *')
  //
  // KOL review reminders — hourly, each run looks at kol_contacts whose
  // review_link_expiry is within 3-5-7 day windows and emits the right
  // reminder tier. Hourly > daily to catch sign-offs that arrive late.
  await producer.schedule('ideation.kol_reminder', {}, '15 * * * *')
  //
  // Calendar overdue — hourly, flips calendar_entries from 'scheduled'
  // to 'overdue' when scheduled_date passes with no publish.
  await producer.schedule('ideation.calendar_overdue', {}, '30 * * * *')
  //
  // Data retention purge — daily 03:00 UTC. Respects the policy in
  // docs/compliance/README.md (sessions 90d / notifications 2y / AI 7y
  // / audit indefinite).
  await producer.schedule('compliance.retention_purge', {}, '0 3 * * *')

  // Queue metrics — polls every 30s so Phase 6 alerts
  // (QueueBacklogGrowing, DeadLetterQueueGrowing) have fresh gauges.
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
  }
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['platform-metrics'],
})
