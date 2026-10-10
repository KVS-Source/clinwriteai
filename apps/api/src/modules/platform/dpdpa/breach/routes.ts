// Breach notification routes — Arc 10.3.
//
//   POST /admin/dpdpa/breaches   super-admin: record a breach + fire 72h notification
//
// Called by the operator (super-admin) when a personal-data breach is
// detected. Writes the audit event, enqueues the notification worker,
// and returns the notification deadline so the UI can display the
// countdown.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'
import { recordBreach } from '../breach-notification.js'

const breachSchema = z.object({
  tenantId: z.string().min(1),
  summary: z.string().min(1).max(500),
  detectedAt: z.string().datetime().optional(),      // defaults to now
  affectedSubjectCount: z.number().int().nonnegative(),
  dataCategories: z.array(z.string()).min(1),
  rootCause: z.string().min(1).max(4000),
  mitigationTaken: z.string().min(1).max(4000),
})

export const breachRoutes: FastifyPluginAsync = async (app) => {
  const superAdmin = requireAuth({ roles: ['super-admin'] })

  app.post('/admin/dpdpa/breaches', { preHandler: superAdmin }, async (request, reply) => {
    const parsed = breachSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const detectedAt = parsed.data.detectedAt ? new Date(parsed.data.detectedAt) : new Date()

    const result = await recordBreach(app, {
      tenantId: parsed.data.tenantId,
      summary: parsed.data.summary,
      detectedAt,
      affectedSubjectCount: parsed.data.affectedSubjectCount,
      dataCategories: parsed.data.dataCategories,
      rootCause: parsed.data.rootCause,
      mitigationTaken: parsed.data.mitigationTaken,
      reportedByUserId: request.user!.id,
    })

    const notificationDeadline = new Date(detectedAt.getTime() + 72 * 60 * 60 * 1000)

    return reply.code(201).send({
      auditEventId: result.auditEventId,
      detectedAt: detectedAt.toISOString(),
      notificationDeadline: notificationDeadline.toISOString(),
      hoursRemaining: 72,
      queuedForNotification: Boolean(app.queue?.enqueue),
    })
  })
}
