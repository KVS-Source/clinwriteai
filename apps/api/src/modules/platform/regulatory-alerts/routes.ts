// Regulatory alerts — cross-module push service (FR-D-024).
//
// Source: 02-datamodel.md §53, 03-api-contract.md §53.
//
// Super-admins publish alerts; every module reads them (unauthed clients
// across all 5 modules get the same payload). Users acknowledge
// individually — the acknowledgedByIds array grows per-user; a user
// seeing their own ID in the list is how the UI decides "already read".
//
// Routes:
//   GET   /regulatory-alerts                       — list active (not archived)
//   GET   /regulatory-alerts/:id                   — detail
//   POST  /admin/regulatory-alerts                 — super-admin create
//   PATCH /regulatory-alerts/:id/acknowledge       — current user acks
//   DELETE /admin/regulatory-alerts/:id            — super-admin archive

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  frameworkName: z.string().min(1).max(128),
  changeSummary: z.string().min(1),
  effectiveDate: z.string().datetime(),
  affectedModules: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).min(1),
  severity: z.enum(['info', 'warning', 'breaking']).default('info'),
  sourceUrl: z.string().url().optional(),
})

export const regulatoryAlertsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regulatory-alerts', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request) => {
    const { module } = request.query as { module?: string }
    return app.prisma.regulatoryAlert.findMany({
      where: {
        archivedAt: null,
        ...(module ? { affectedModules: { has: module } } : {}),
      },
      orderBy: { alertedAt: 'desc' },
    })
  })

  app.get('/regulatory-alerts/:alertId', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })
    return alert
  })

  app.post('/admin/regulatory-alerts', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const alert = await app.prisma.regulatoryAlert.create({
      data: {
        frameworkName: parsed.data.frameworkName,
        changeSummary: parsed.data.changeSummary,
        effectiveDate: new Date(parsed.data.effectiveDate),
        affectedModules: parsed.data.affectedModules,
        severity: parsed.data.severity,
        sourceUrl: parsed.data.sourceUrl,
        publishedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'regulatory_alert_published',
      entityType: 'regulatory_alert',
      entityId: alert.id,
      details: {
        frameworkName: alert.frameworkName,
        affectedModules: alert.affectedModules,
        severity: alert.severity,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(alert)
  })

  app.patch('/regulatory-alerts/:alertId/acknowledge', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })
    const userId = request.user!.id
    if (alert.acknowledgedByIds.includes(userId)) {
      return alert  // idempotent — already acknowledged
    }

    const updated = await app.prisma.regulatoryAlert.update({
      where: { id: alertId },
      data: { acknowledgedByIds: { push: userId } },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: userId,
      action: 'regulatory_alert_acknowledged',
      entityType: 'regulatory_alert',
      entityId: alertId,
      details: { frameworkName: alert.frameworkName },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.delete('/admin/regulatory-alerts/:alertId', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })

    const archived = await app.prisma.regulatoryAlert.update({
      where: { id: alertId },
      data: { archivedAt: new Date() },
    })
    return archived
  })
}
