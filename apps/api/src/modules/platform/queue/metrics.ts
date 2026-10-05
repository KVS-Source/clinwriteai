// Queue metrics scheduler — polls BullMQ for job counts on each tick and
// publishes gauges that the Phase 6 alerts rely on (QueueBacklogGrowing,
// DeadLetterQueueGrowing).
//
// The Phase 6 alerts expect metric names of the form
// `bullmq_queue_waiting{job="platform-worker"}`. Our Prometheus scrape
// target is the API, not the worker, so we expose these gauges from
// here with a stable `job="platform-worker"` label (even though the
// gauge is published by the API — this matches the alert expression).

import type { Queue } from 'bullmq'
import type { Gauge } from 'prom-client'

export interface QueueMetricsOptions {
  queues: Map<string, Queue>                                       // queue-name → Queue
  waiting: Gauge<'name' | 'job'>
  active: Gauge<'name' | 'job'>
  failed: Gauge<'name' | 'job'>
  delayed: Gauge<'name' | 'job'>
  tickMs: number
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
}

export class QueueMetricsScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly opts: QueueMetricsOptions) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    for (const [name, queue] of this.opts.queues.entries()) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed')
        this.opts.waiting.set({ name, job: 'platform-worker' }, counts.waiting ?? 0)
        this.opts.active.set({ name, job: 'platform-worker' }, counts.active ?? 0)
        this.opts.failed.set({ name, job: 'platform-worker' }, counts.failed ?? 0)
        this.opts.delayed.set({ name, job: 'platform-worker' }, counts.delayed ?? 0)
      } catch (err) {
        this.opts.logger.error({ queue: name, err }, 'queue counts fetch failed')
      }
    }
  }
}
