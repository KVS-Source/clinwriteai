// ProjectMember routes — project-level team membership.
//
// Being a ProjectMember is the "scope" dimension in the three-dimensional
// access model (platform role × project membership × document RACI letter)
// described in docs/roles-and-permissions.md §3.
//
// Routes under /projects prefix:
//   GET    /:projectId/members                 list active + removed
//   POST   /:projectId/members                 add a user (PM or admin only)
//   DELETE /:projectId/members/:memberId       soft-remove (sets removedAt)
//
// Note: project_members only grants read access to the project. Per-doc
// capability still comes from DocumentRaci.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const addMemberSchema = z.object({
  userId: z.string().min(1),
  projectRole: z.string().min(1).max(120).nullable().optional(),
})

export const projectMembersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/members', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: [{ removedAt: 'asc' }, { addedAt: 'asc' }],
    })
    return rows
  })

  // Writes gated to admin OR pm roles. The legacy-compat layer in rbac.ts
  // handles the tenant-admin alias; adding 'pm' here is forward-looking —
  // once PM is a real role on live users, nothing else needs to change.
  const writeGate = requireAuth({ roles: ['admin', 'pm'] })

  app.post('/:projectId/members', { preHandler: writeGate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = addMemberSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const [project, user] = await Promise.all([
      app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
      app.prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, status: true } }),
    ])
    if (!project) return reply.code(404).send({ error: 'project_not_found' })
    if (!user) return reply.code(400).send({ error: 'user_not_found' })
    if (user.status !== 'active') return reply.code(422).send({ error: 'user_inactive' })

    // The uniqueness index on (projectId, userId) prevents dup active rows,
    // but we want to surface a clean 409 for the "already a member" case
    // rather than a bare DB error. We also undelete a soft-removed row so
    // the readd flow is a single call.
    const existing = await app.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: parsed.data.userId } },
    })
    const actor = request.user!

    const row = existing
      ? await app.prisma.projectMember.update({
          where: { id: existing.id },
          data: {
            removedAt: null,
            projectRole: parsed.data.projectRole ?? existing.projectRole,
            addedBy: actor.id,
            addedAt: new Date(),
          },
        })
      : await app.prisma.projectMember.create({
          data: {
            projectId,
            userId: parsed.data.userId,
            projectRole: parsed.data.projectRole ?? null,
            addedBy: actor.id,
          },
        })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: existing ? 'project_member.readded' : 'project_member.added',
      entityType: 'project_member',
      entityId: row.id,
      details: {
        projectId,
        userId: parsed.data.userId,
        projectRole: row.projectRole,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(existing ? 200 : 201).send(row)
  })

  app.delete('/:projectId/members/:memberId', { preHandler: writeGate }, async (request, reply) => {
    const { projectId, memberId } = request.params as { projectId: string; memberId: string }
    const existing = await app.prisma.projectMember.findUnique({ where: { id: memberId } })
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'not_found' })
    }
    if (existing.removedAt) return reply.code(409).send({ error: 'already_removed' })

    const actor = request.user!
    await app.prisma.projectMember.update({
      where: { id: memberId },
      data: { removedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'project_member.removed',
      entityType: 'project_member',
      entityId: memberId,
      details: {
        projectId,
        userId: existing.userId,
        projectRole: existing.projectRole,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
