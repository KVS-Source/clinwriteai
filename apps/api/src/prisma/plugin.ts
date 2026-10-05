// Fastify plugin that owns the Prisma client lifecycle and decorates the
// instance so handlers get typed access via `app.prisma`.
//
// Per ADR 0002: Prisma for 95% of models; raw SQL repository for audit_events.
// Feature code uses `app.prisma.user.findUnique(...)`; audit writes go through
// `app.audit.append(...)` (see audit/plugin.ts).

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

const prismaPlugin: FastifyPluginAsync = async (app) => {
  const prisma = new PrismaClient({
    log: app.env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
  })

  // Verify connectivity at boot — fail fast if the DB is unreachable
  await prisma.$connect()
  app.log.info({ phase: 'startup' }, 'Prisma connected to Postgres')

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
