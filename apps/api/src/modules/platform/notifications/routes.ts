// Notification routes — the in-app feed + mark-read + direct send (admin).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const sendSchema = z.object({
  recipientId: z.string().min(1),
  kind: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  title: z.string().min(1),
  body: z.string().min(1),
  linkPath: z.string().optional(),
  channels: z.array(z.enum(['in_app', 'email', 'sms'])).default(['in_app']),
  payload: z.record(z.unknown()).optional(),
})

const listQuery = z.object({
  unread: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // The in-app feed for the current user.
  app.get('/me', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const userId = request.user!.id

    return app.prisma.notification.findMany({
      where: {
        recipientId: userId,
        dismissedAt: null,
        ...(parsed.data.unread && { readAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
    })
  })

  app.get('/me/unread-count', { preHandler: requireAuth() }, async (request) => {
    const count = await app.prisma.notification.count({
      where: { recipientId: request.user!.id, readAt: null, dismissedAt: null },
    })
    return { count }
  })

  app.post('/me/mark-read', { preHandler: requireAuth() }, async (request) => {
    const parsed = z.object({ ids: z.array(z.string().min(1)) }).safeParse(request.body ?? { ids: [] })
    if (!parsed.success) return { updated: 0 }
    const result = await app.prisma.notification.updateMany({
      where: { recipientId: request.user!.id, id: { in: parsed.data.ids }, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  })

  app.post('/me/mark-all-read', { preHandler: requireAuth() }, async (request) => {
    const result = await app.prisma.notification.updateMany({
      where: { recipientId: request.user!.id, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  })

  app.post('/me/:id/dismiss', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.notification.findFirst({
      where: { id, recipientId: request.user!.id },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.notification.update({
      where: { id },
      data: { dismissedAt: new Date(), readAt: row.readAt ?? new Date() },
    })
  })

  // Direct send endpoint — admin-only. Feature modules call
  // `app.notifications.send(...)` directly rather than hitting this route.
  app.post('/', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const parsed = sendSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const notification = await app.notifications.send(parsed.data)

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'notification_sent',
      entityType: 'notification',
      entityId: notification.id,
      details: {
        recipientId: parsed.data.recipientId,
        kind: parsed.data.kind,
        channels: parsed.data.channels,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(notification)
  })
}
