// Mounts the automatic ICH sync (./ich-auto-sync.ts) and stops it on close so dev --watch restarts don't leak timers.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { IchAutoSync, ichAutoSyncEnabled } from './ich-auto-sync.js'

const ichAutoSyncPlugin: FastifyPluginAsync = async (app) => {
  if (!ichAutoSyncEnabled({ NODE_ENV: app.env.NODE_ENV, ICH_AUTO_SYNC: process.env.ICH_AUTO_SYNC })) {
    app.log.info('Automatic ICH sync is off')
    return
  }
  const job = new IchAutoSync({ prisma: app.prisma as never, audit: app.audit as never, logger: app.log })
  job.start()
  app.addHook('onClose', async () => job.stop())
}

export default fp(ichAutoSyncPlugin, { name: 'ich-auto-sync', dependencies: ['prisma', 'audit'] })
