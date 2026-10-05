// Fastify plugin exposing app.notifications for cross-module use.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { NotificationService } from './service.js'

const notificationsPlugin: FastifyPluginAsync = async (app) => {
  const service = new NotificationService(app.prisma)
  app.decorate('notifications', service)
}

declare module 'fastify' {
  interface FastifyInstance {
    notifications: NotificationService
  }
}

export default fp(notificationsPlugin, {
  name: 'notifications',
  dependencies: ['prisma'],
})
