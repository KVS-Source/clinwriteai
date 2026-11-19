// Mounts the automatic ICH sync (./ich-auto-sync.ts) and stops it on close so dev --watch restarts don't leak timers.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { ICH_SYNC_NOTIFICATION_KIND, IchAutoSync, activeProjectManagerIds, ichAutoSyncEnabled, type IchSyncNotice } from './ich-auto-sync.js'

const ichAutoSyncPlugin: FastifyPluginAsync = async (app) => {
  if (!ichAutoSyncEnabled({ NODE_ENV: app.env.NODE_ENV, ICH_AUTO_SYNC: process.env.ICH_AUTO_SYNC })) {
    app.log.info('Automatic ICH sync is off')
    return
  }
  // Each active Project Manager gets the result in their notifications; one failing recipient doesn't stop the rest.
  const notify = async (n: IchSyncNotice) => {
    if (!app.hasDecorator('notifications')) return
    for (const recipientId of await activeProjectManagerIds(app.prisma as never)) {
      try {
        await app.notifications.send({ recipientId, kind: ICH_SYNC_NOTIFICATION_KIND, title: n.title, body: n.body, linkPath: '/master-library/ich-frameworks', payload: {} })
      } catch (err) {
        app.log.warn({ err, recipientId }, 'ICH sync notification failed')
      }
    }
  }
  const job = new IchAutoSync({ prisma: app.prisma as never, audit: app.audit as never, logger: app.log, notify })
  job.start()
  app.addHook('onClose', async () => job.stop())
}

export default fp(ichAutoSyncPlugin, { name: 'ich-auto-sync', dependencies: ['prisma', 'audit'] })
