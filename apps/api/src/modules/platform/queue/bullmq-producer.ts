// BullMQ-backed QueueProducer. Each job name gets its own Queue instance
// (BullMQ pattern — queues are keyed by name on the Redis side; one Queue
// object per name keeps metrics + concurrency per-name).
//
// Redis connection shared with ioredis — BullMQ requires `maxRetriesPerRequest:
// null` on the shared connection, otherwise long-poll BRPOPLPUSH fails.

import { Queue, type JobsOptions } from 'bullmq'
import { Redis } from 'ioredis'
import type { QueueJobName, QueueJobOptions, QueueProducer } from './producer.js'

export class BullMqProducer implements QueueProducer {
  private readonly queues = new Map<QueueJobName, Queue>()

  constructor(private readonly connection: Redis) {}

  /** Exposed for the metrics scheduler (./metrics.ts). */
  getQueues(): Map<string, Queue> {
    return this.queues as unknown as Map<string, Queue>
  }

  private getQueue(name: QueueJobName): Queue {
    const existing = this.queues.get(name)
    if (existing) return existing
    const q = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },  // keep failures a week for triage
      },
    })
    this.queues.set(name, q)
    return q
  }

  async enqueue<P>(name: QueueJobName, payload: P, opts: QueueJobOptions = {}): Promise<{ jobId: string }> {
    const q = this.getQueue(name)
    const jobOpts: JobsOptions = {
      ...(opts.delayMs !== undefined && { delay: opts.delayMs }),
      ...(opts.attempts !== undefined && { attempts: opts.attempts }),
      ...(opts.jobId !== undefined && { jobId: opts.jobId }),
    }
    const job = await q.add(name, payload as object, jobOpts)
    return { jobId: String(job.id) }
  }

  async schedule<P>(name: QueueJobName, payload: P, cron: string): Promise<void> {
    const q = this.getQueue(name)
    // repeat.pattern IDs are stable per (name, cron, payload-hash) so this
    // is safe to re-run on every boot without piling up duplicates.
    await q.add(name, payload as object, {
      repeat: { pattern: cron },
      jobId: `cron:${name}:${cron}`,
    })
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map(q => q.close()))
  }
}

export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    // BullMQ requires both of these on connections used for blocking
    // commands (brpoplpush et al). Non-negotiable per the BullMQ docs.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  })
}
