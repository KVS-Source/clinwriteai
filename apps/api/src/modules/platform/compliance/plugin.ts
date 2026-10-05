// Compliance plugin — mounts the ComplianceGaugeScheduler and tears it
// down on `onClose` so dev `--watch` restarts don't leak timers.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { ComplianceGaugeScheduler } from './gauge-scheduler.js'

const DEFAULT_TICK_MS = 5 * 60 * 1000  // 5 min, matches alerts.yml interval
const DEV_TICK_MS = 60 * 1000          // 1 min in dev so you can watch

const compliancePlugin: FastifyPluginAsync = async (app) => {
  const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
  const scheduler = new ComplianceGaugeScheduler({
    prisma: app.prisma,
    metrics: app.platformMetrics,
    auditSecret,
    tickMs: app.env.NODE_ENV === 'development' ? DEV_TICK_MS : DEFAULT_TICK_MS,
    backupTimestampFile: process.env.PLATFORM_BACKUP_TS_FILE ?? '/var/lib/platform/backup.last_success',
    drillTimestampFile: process.env.PLATFORM_BACKUP_DRILL_TS_FILE ?? '/var/lib/platform/backup.drill_last_success',
    logger: app.log,
  })

  scheduler.start()
  app.addHook('onClose', async () => scheduler.stop())
  app.decorate('complianceScheduler', scheduler)
}

declare module 'fastify' {
  interface FastifyInstance {
    complianceScheduler: ComplianceGaugeScheduler
  }
}

export default fp(compliancePlugin, {
  name: 'compliance-scheduler',
  dependencies: ['prisma', 'audit', 'platform-metrics'],
})
