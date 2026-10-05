// RACI matrix routes — per-project activity assignments.
//
// Model (data model + plan §4):
//   - One row per (projectId, activity). Activities are free-text strings
//     describing a workflow step (e.g. 'clinical_writing.draft',
//     'regulatory.publish'). The platform-wide activity catalogue is NOT
//     separately modeled yet; this scaffold accepts any non-empty string.
//   - responsibleId + accountableId are at most one user each; consulted
//     and informed are string[] of user ids.
//   - UPSERT semantics on PUT — one assignment per (projectId, activity).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const upsertSchema = z.object({
  activity: z.string().min(1),
  responsibleId: z.string().optional().nullable(),
  accountableId: z.string().optional().nullable(),
  consultedIds: z.array(z.string()).default([]),
  informedIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
})

export const raciRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/raci', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    return app.prisma.raciAssignment.findMany({
      where: { projectId },
      orderBy: { activity: 'asc' },
    })
  })

  app.put('/:projectId/raci', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = upsertSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const row = await app.prisma.raciAssignment.upsert({
      where: { projectId_activity: { projectId, activity: parsed.data.activity } },
      create: {
        projectId,
        activity: parsed.data.activity,
        responsibleId: parsed.data.responsibleId ?? null,
        accountableId: parsed.data.accountableId ?? null,
        consultedIds: parsed.data.consultedIds,
        informedIds: parsed.data.informedIds,
        notes: parsed.data.notes ?? null,
        updatedBy: request.user!.id,
      },
      update: {
        responsibleId: parsed.data.responsibleId ?? null,
        accountableId: parsed.data.accountableId ?? null,
        consultedIds: parsed.data.consultedIds,
        informedIds: parsed.data.informedIds,
        notes: parsed.data.notes ?? null,
        updatedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'raci_assignment_set',
      entityType: 'raci_assignment',
      entityId: row.id,
      details: {
        projectId,
        activity: parsed.data.activity,
        responsibleId: parsed.data.responsibleId ?? null,
        accountableId: parsed.data.accountableId ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    return row
  })

  app.delete('/:projectId/raci/:activity', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { projectId, activity } = request.params as { projectId: string; activity: string }
    const existing = await app.prisma.raciAssignment.findUnique({
      where: { projectId_activity: { projectId, activity } },
    })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    await app.prisma.raciAssignment.delete({ where: { id: existing.id } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'raci_assignment_deleted',
      entityType: 'raci_assignment',
      entityId: existing.id,
      details: { projectId, activity },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
