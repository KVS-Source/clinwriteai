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
// The project's managers (see projects/project-managers.ts):
//   GET    /pm-directory                       the PMs a PM can pick from
//   GET    /:projectId/managers                who manages this project
//   POST   /:projectId/managers                add one from the list { userId }
//   POST   /:projectId/managers/invite         invite one by email { email }
//   POST   /:projectId/managers/:userId/resend send an invited PM a fresh link
//   DELETE /:projectId/managers/:userId        take one off; the last active PM stays
//
// Note: project_members only grants read access to the project. Per-doc
// capability still comes from DocumentRaci.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { hasAnyRole, requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import { issueUserInvitation } from '../users/issue-invitation.js'
import {
  actorManagesProject, addPmToProject, checkPmEmail, createInvitedPm, findSelectablePm, LAST_PM, PM_EMAIL_TAKEN,
  PM_FORBIDDEN, PM_USER_NOT_ELIGIBLE, pmDirectory,
} from '../../projects/project-managers.js'

const addMemberSchema = z.object({
  userId: z.string().min(1),
  projectRole: z.string().min(1).max(120).nullable().optional(),
})

const addManagerSchema = z.object({ userId: z.string().min(1) })
const inviteManagerSchema = z.object({ email: z.string().trim().email() })

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

  // A PM changes the members of their own projects only, not of any project.
  const refusedAsOutsidePm = async (actor: AuthenticatedUser, projectId: string) =>
    hasAnyRole(actor, 'pm') && !(await actorManagesProject(app.prisma, actor, projectId))

  const pmGate = requireAuth({ roles: ['pm'] })

  app.get('/pm-directory', { preHandler: pmGate }, async (request) => pmDirectory(app.prisma, request.user!))

  // The managers of a project a PM works on: every PM's name and status, and who added them.
  const managersOf = async (projectId: string) => {
    const rows = await app.prisma.projectMember.findMany({
      where: { projectId, removedAt: null, user: { role: 'pm' } },
      orderBy: { addedAt: 'asc' },
      select: { addedBy: true, addedAt: true, user: { select: { id: true, name: true, email: true, status: true } } },
    })
    return rows.map(r => ({ ...r.user, addedBy: r.addedBy, addedAt: r.addedAt, isCreator: r.addedBy === r.user.id }))
  }

  // Loads the project and checks the caller manages it; sends the refusal otherwise.
  const managedProject = async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } })
    if (!project) { await reply.code(404).send({ error: 'project_not_found' }); return null }
    if (!(await actorManagesProject(app.prisma, request.user!, projectId))) { await reply.code(403).send(PM_FORBIDDEN); return null }
    return project
  }

  app.get('/:projectId/managers', { preHandler: pmGate }, async (request, reply) => {
    const project = await managedProject(request, reply)
    return project ? managersOf(project.id) : reply
  })

  app.post('/:projectId/managers', { preHandler: pmGate }, async (request, reply) => {
    const project = await managedProject(request, reply)
    if (!project) return reply
    const parsed = addManagerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const user = await findSelectablePm(app.prisma, request.user!, parsed.data.userId)
    if (!user) return reply.code(422).send(PM_USER_NOT_ELIGIBLE)
    const { added, emailQueued } = await addPmToProject(app, request, project, user)
    return reply.code(added ? 201 : 200).send({ managers: await managersOf(project.id), emailQueued })
  })

  app.post('/:projectId/managers/invite', { preHandler: pmGate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const project = await managedProject(request, reply)
    if (!project) return reply
    const parsed = inviteManagerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const found = await checkPmEmail(app.prisma, request.user!, parsed.data.email)
    if (found === 'refused') return reply.code(422).send(PM_EMAIL_TAKEN)
    const user = found ?? await createInvitedPm(app, request, parsed.data.email)
    const { added, emailQueued } = await addPmToProject(app, request, project, user)
    return reply.code(added ? 201 : 200).send({ managers: await managersOf(project.id), emailQueued })
  })

  // Invitation links are short-lived, so an invited PM may need another one.
  app.post('/:projectId/managers/:userId/resend', { preHandler: pmGate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const project = await managedProject(request, reply)
    if (!project) return reply
    const { userId } = request.params as { userId: string }
    const member = await app.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId } } })
    const user = member && !member.removedAt ? await findSelectablePm(app.prisma, request.user!, userId) : null
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (user.status !== 'invited') return reply.code(409).send({ error: 'not_invited', message: 'This person has already activated their account.' })
    const { emailQueued, inviteExpiresAt } = await issueUserInvitation(app, user, request.user!.id, `You have been added as a project manager on "${project.name}".`)
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'project.manager_invite_resent',
      entityType: 'project',
      entityId: project.id,
      details: { projectId: project.id, userId, email: user.email, inviteExpiresAt, emailQueued },
      ipAddress: request.ip ?? null,
    })
    return { emailQueued }
  })

  app.delete('/:projectId/managers/:userId', { preHandler: pmGate }, async (request, reply) => {
    const project = await managedProject(request, reply)
    if (!project) return reply
    const { userId } = request.params as { userId: string }
    const member = await app.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId } } })
    if (!member || member.removedAt) return reply.code(404).send({ error: 'not_found' })
    const managers = await managersOf(project.id)
    if (!managers.some(m => m.status === 'active' && m.id !== userId)) return reply.code(409).send(LAST_PM)
    await app.prisma.projectMember.update({ where: { id: member.id }, data: { removedAt: new Date() } })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'project.manager_removed',
      entityType: 'project',
      entityId: project.id,
      details: { projectId: project.id, userId },
      ipAddress: request.ip ?? null,
    })
    return { managers: await managersOf(project.id) }
  })

  app.post('/:projectId/members', { preHandler: writeGate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    if (await refusedAsOutsidePm(request.user!, projectId)) return reply.code(403).send(PM_FORBIDDEN)
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
    if (await refusedAsOutsidePm(request.user!, projectId)) return reply.code(403).send(PM_FORBIDDEN)
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
