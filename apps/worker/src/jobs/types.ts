// Shared types for worker job handlers.

import type { Job } from 'bullmq'
import type { PrismaClient } from '@prisma/client'
import type pino from 'pino'
import type { Redis } from 'ioredis'

export interface JobContext {
  prisma: PrismaClient
  log: pino.Logger
  // Shared Redis connection — same instance BullMQ uses for queue state.
  // Workers reuse it for pub/sub (publish to aurora:realtime channel) so
  // the API can forward to Socket.io rooms. Reusing the connection avoids
  // a second pool.
  redis: Redis
}

export type JobHandler<P = unknown, R = unknown> = (job: Job<P>, ctx: JobContext) => Promise<R>
