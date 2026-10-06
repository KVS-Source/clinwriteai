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

// Shape RegulatoryAlert rows for the UI's packages/types RegulatoryAlert
// interface. Date → ISO coercion for the two timestamp fields, plus three
// Prisma-side gaps the UI treats as present:
//   - isEffectiveDateEstimate: boolean — not stored; defaults to false
//     until a flag column lands (publishers that know the date is firm
//     will stay accurate; estimated-date flows can set it when the data
//     model expands).
//   - affectedDossierSections: UI expects a cross-reference to CTD
//     sections impacted by the alert. No table for this today — [].
//   - actionRequired: author-written guidance ("re-run CMC consistency",
//     "update label section 5.1", etc). Not persisted — ''.
//   - sourceUrl: UI treats this non-nullable; coerce null → ''.
function regulatoryAlertShape(a: {
  id: string
  frameworkName: string
  changeSummary: string
  effectiveDate: Date
  affectedModules: string[]
  sourceUrl: string | null
  alertedAt: Date
  acknowledgedByIds: string[]
}) {
  return {
    id: a.id,
    frameworkName: a.frameworkName,
    changeSummary: a.changeSummary,
    effectiveDate: a.effectiveDate.toISOString(),
    isEffectiveDateEstimate: false,
    affectedModules: a.affectedModules,
    alertedAt: a.alertedAt.toISOString(),
    acknowledgedByIds: a.acknowledgedByIds,
    affectedDossierSections: [] as string[],
    actionRequired: '',
    sourceUrl: a.sourceUrl ?? '',
  }
}

export const regulatoryAlertsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regulatory-alerts', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request) => {
    const { module } = request.query as { module?: string }
    const rows = await app.prisma.regulatoryAlert.findMany({
      where: {
        archivedAt: null,
        ...(module ? { affectedModules: { has: module } } : {}),
      },
      orderBy: { alertedAt: 'desc' },
    })
    return rows.map(regulatoryAlertShape)
  })

  app.get('/regulatory-alerts/:alertId', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })
    return regulatoryAlertShape(alert)
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

    return reply.code(201).send(regulatoryAlertShape(alert))
  })

  app.patch('/regulatory-alerts/:alertId/acknowledge', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })
    const userId = request.user!.id
    if (alert.acknowledgedByIds.includes(userId)) {
      return regulatoryAlertShape(alert)  // idempotent — already acknowledged
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

    return regulatoryAlertShape(updated)
  })

  app.delete('/admin/regulatory-alerts/:alertId', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string }
    const alert = await app.prisma.regulatoryAlert.findUnique({ where: { id: alertId } })
    if (!alert) return reply.code(404).send({ error: 'not_found' })

    const archived = await app.prisma.regulatoryAlert.update({
      where: { id: alertId },
      data: { archivedAt: new Date() },
    })
    return regulatoryAlertShape(archived)
  })
}
