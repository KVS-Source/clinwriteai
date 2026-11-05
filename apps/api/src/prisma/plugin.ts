// Fastify plugin that owns the Prisma client lifecycle and decorates the
// instance so handlers get typed access via `app.prisma`.
//
// Per ADR 0002: Prisma for 95% of models; raw SQL repository for audit_events.
// Feature code uses `app.prisma.user.findUnique(...)`; audit writes go through
// `app.audit.append(...)` (see audit/plugin.ts).

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import { withPoolSettings } from './pool-url.js'

const prismaPlugin: FastifyPluginAsync = async (app) => {
  // A bounded, named pool (see pool-url.ts): 5 connections per local API unless set otherwise.
  const datasourceUrl = process.env.DATABASE_URL
    ? withPoolSettings(process.env.DATABASE_URL, { app: 'clinwrite-api', devLimit: 5 })
    : undefined
  const prisma = new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: app.env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
  })

  // Verify connectivity at boot — fail fast if the DB is unreachable
  await prisma.$connect()
  const pool = datasourceUrl ? new URL(datasourceUrl).searchParams : null
  app.log.info({ phase: 'startup', connectionLimit: pool?.get('connection_limit') ?? 'prisma default', applicationName: pool?.get('application_name') }, 'Prisma connected to Postgres')

  app.decorate('prisma', prisma)

  app.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect()
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

export default fp(prismaPlugin, { name: 'prisma' })
