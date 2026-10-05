// Fastify plugin exposing app.notifications for cross-module use.
//
// Depends on 'queue' so email/sms deliveries can enqueue to BullMQ.
// Mounting after the queue plugin means service.send() always sees a
// configured QueueProducer.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { NotificationService } from './service.js'

const notificationsPlugin: FastifyPluginAsync = async (app) => {
  const service = new NotificationService(app.prisma, app.queue)
  app.decorate('notifications', service)
}

declare module 'fastify' {
  interface FastifyInstance {
    notifications: NotificationService
  }
}

export default fp(notificationsPlugin, {
  name: 'notifications',
  dependencies: ['prisma', 'queue'],
})
