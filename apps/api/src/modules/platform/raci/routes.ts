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
//   - Last write wins: concurrent admins may overwrite each other. That is
//     accepted because every PUT/DELETE audits the full before + after state,
//     so any overwritten version can be reconstructed from the audit chain.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

interface RaciRowLike {
  responsibleId: string | null
  accountableId: string | null
  consultedIds:  string[]
  informedIds:   string[]
  notes:         string | null
  updatedBy:     string
  updatedAt:     Date
}

// Snapshot of the assignable fields for audit details (before / after).
// JSON-plain values only (no Date, no undefined): the audit row hash is computed
// over canonical JSON, and anything that changes on a JSONB round-trip would
// break chain verification.
function raciAuditSnapshot(row: RaciRowLike | null) {
  if (!row) return null
  return {
    responsibleId: row.responsibleId ?? null,
    accountableId: row.accountableId ?? null,
    consultedIds:  row.consultedIds ?? [],
    informedIds:   row.informedIds ?? [],
    notes:         row.notes ?? null,
    updatedBy:     row.updatedBy ?? null,
    updatedAt:     row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  }
}

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

    // Every referenced person must be a real user — otherwise the row would carry dangling ids.
    const referencedIds = Array.from(new Set([
      parsed.data.responsibleId,
      parsed.data.accountableId,
      ...parsed.data.consultedIds,
      ...parsed.data.informedIds,
    ].filter((id): id is string => !!id)))
    if (referencedIds.length > 0) {
      const found = await app.prisma.user.findMany({ where: { id: { in: referencedIds } }, select: { id: true } })
      const foundIds = new Set(found.map(u => u.id))
      const unknownUserIds = referencedIds.filter(id => !foundIds.has(id))
      if (unknownUserIds.length > 0) return reply.code(400).send({ error: 'unknown_user', userIds: unknownUserIds })
    }

    const before = await app.prisma.raciAssignment.findUnique({
      where: { projectId_activity: { projectId, activity: parsed.data.activity } },
    })

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
        created:  !before,
        before:   raciAuditSnapshot(before),
        after:    raciAuditSnapshot(row),
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
      details: { projectId, activity, before: raciAuditSnapshot(existing) },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
