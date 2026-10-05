// Shared types for worker job handlers.

import type { Job } from 'bullmq'
import type { PrismaClient } from '@prisma/client'
import type pino from 'pino'

export interface JobContext {
  prisma: PrismaClient
  log: pino.Logger
}

export type JobHandler<P = unknown, R = unknown> = (job: Job<P>, ctx: JobContext) => Promise<R>
