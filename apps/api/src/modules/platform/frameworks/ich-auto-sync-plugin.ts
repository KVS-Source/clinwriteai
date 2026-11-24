// Mounts the automatic ICH sync (./ich-auto-sync.ts) and stops it on close so dev --watch restarts don't leak timers.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { IchAutoSync, ichAutoSyncEnabled, notifyProjectManagersOfIchSync, type IchSyncNotice } from './ich-auto-sync.js'

const ichAutoSyncPlugin: FastifyPluginAsync = async (app) => {
  if (!ichAutoSyncEnabled({ NODE_ENV: app.env.NODE_ENV, ICH_AUTO_SYNC: process.env.ICH_AUTO_SYNC })) {
    app.log.info('Automatic ICH sync is off')
    return
  }
  // Each active Project Manager gets the result in their notifications; one failing recipient doesn't stop the rest.
  const notify = async (n: IchSyncNotice) => {
    if (!app.hasDecorator('notifications')) return
    await notifyProjectManagersOfIchSync({ prisma: app.prisma as never, notifications: app.notifications as never, logger: app.log }, n)
  }
  const job = new IchAutoSync({ prisma: app.prisma as never, audit: app.audit as never, logger: app.log, notify })
  job.start()
  app.addHook('onClose', async () => job.stop())
}

export default fp(ichAutoSyncPlugin, { name: 'ich-auto-sync', dependencies: ['prisma', 'audit'] })
