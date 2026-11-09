// A project's managers: users with the platform role `pm` and an active ProjectMember row on it.
// The creator is the first; any PM on the project can add other PMs, picked from the PMs in their
// tenant or invited by email.
//
// An email that already belongs to someone who isn't a PM here is refused, not promoted: changing a
// person's role stays with the tenant admin. The invitation link goes only to the invited person's
// email, never to the PM who invited them, so a PM can't activate an account in someone else's name
// (that account would go on to sign documents).

import type { PrismaClient, User } from '@prisma/client'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { hasAnyRole, type AuthenticatedUser } from '../../auth/rbac.js'
import { issueUserInvitation } from '../platform/users/issue-invitation.js'
import { PM_PROJECT_ROLE, visibleProjectIdsForUser } from './visibility.js'

// Who can be made a project's PM: not someone suspended or deprovisioned.
const SELECTABLE_STATUSES = ['active', 'invited']

export const PM_FORBIDDEN = {
  error: 'project_manager_forbidden',
  message: 'Only a project manager on this project can do this.',
} as const

export const PM_EMAIL_TAKEN = {
  error: 'pm_email_not_pm',
  message: "This email already belongs to an account that isn't a project manager here. Ask your tenant admin to change their role, then add them.",
} as const

export const PM_USER_NOT_ELIGIBLE = {
  error: 'pm_user_not_eligible',
  message: 'This person is not an available project manager.',
} as const

export const LAST_PM = {
  error: 'last_project_manager',
  message: 'A project needs at least one active project manager. Add another before removing this one.',
} as const

/** A PM who works on this project (the same rule that lets them see it). */
export async function actorManagesProject(prisma: PrismaClient, actor: AuthenticatedUser, projectId: string): Promise<boolean> {
  if (!hasAnyRole(actor, 'pm')) return false
  const visible = await visibleProjectIdsForUser(prisma, actor)
  return visible === 'all' || visible.has(projectId)
}

/** The PMs a PM can pick from: everyone with the role in their own tenant who can sign in, or has been invited to. */
export function pmDirectory(prisma: PrismaClient, actor: AuthenticatedUser) {
  return prisma.user.findMany({
    // A PM is anyone holding the role, as their primary or their additional role.
    where: { OR: [{ role: 'pm' }, { additionalRoles: { has: 'pm' } }], tenantId: actor.tenantId ?? null, status: { in: SELECTABLE_STATUSES } },
    select: { id: true, name: true, email: true, status: true },
    orderBy: { name: 'asc' },
  })
}

/** A person from the list: must be an available PM in the actor's tenant. */
export async function findSelectablePm(prisma: PrismaClient, actor: AuthenticatedUser, userId: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !holdsPm(user) || (user.tenantId ?? null) !== (actor.tenantId ?? null) || !SELECTABLE_STATUSES.includes(user.status)) return null
  return user
}

// Holds the PM role, as their primary role or their additional one.
const holdsPm = (u: { role: string; additionalRoles?: string[] | null }) => u.role === 'pm' || (u.additionalRoles ?? []).includes('pm')

export const normaliseEmail = (email: string): string => email.trim().toLowerCase()

/**
 * What an email means for a PM invitation: nobody yet (null), or an available PM here (that user).
 * 'refused' for anyone else, with one message whatever the reason, so this doesn't reveal which
 * emails have accounts in other tenants.
 */
export async function checkPmEmail(prisma: PrismaClient, actor: AuthenticatedUser, email: string): Promise<User | null | 'refused'> {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } })
  if (!user) return null
  const usable = holdsPm(user) && (user.tenantId ?? null) === (actor.tenantId ?? null) && SELECTABLE_STATUSES.includes(user.status)
  return usable ? user : 'refused'
}

// "jane.doe@x.com" → "Jane Doe". A placeholder: the invitee enters their own name when registering.
const nameFromEmail = (email: string) =>
  email.split('@')[0]!.split(/[._-]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || email

/** A new account for an invited PM. They get the same modules as the PM inviting them. */
export async function createInvitedPm(app: FastifyInstance, request: FastifyRequest, email: string): Promise<User> {
  const actor = request.user!
  const normalised = normaliseEmail(email)
  const created = await app.prisma.user.create({
    data: { email: normalised, name: nameFromEmail(normalised), role: 'pm', modules: actor.modules ?? [], tenantId: actor.tenantId ?? null, status: 'invited' },
  })
  await app.audit.append({
    timestamp: new Date().toISOString(),
    actorId: actor.id,
    action: 'user.invite',
    entityType: 'user',
    entityId: created.id,
    details: { email: created.email, role: created.role, modules: created.modules, via: 'project_manager_invite' },
    ipAddress: request.ip ?? null,
  })
  return created
}

/** Puts a PM on the project (bringing back a removed row) and records it. No-op when they already are one. */
export async function addPmToProject(
  app: FastifyInstance,
  request: FastifyRequest,
  project: { id: string; name: string },
  user: User,
): Promise<{ added: boolean; emailQueued: boolean | null }> {
  const actor = request.user!
  const existing = await app.prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
  })
  const added = !existing || existing.removedAt !== null
  if (existing) {
    if (existing.removedAt) {
      await app.prisma.projectMember.update({
        where: { id: existing.id },
        data: { removedAt: null, projectRole: PM_PROJECT_ROLE, addedBy: actor.id, addedAt: new Date() },
      })
    }
  } else {
    await app.prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, projectRole: PM_PROJECT_ROLE, addedBy: actor.id },
    })
  }

  // Someone still invited gets a link (a fresh one if they had one); someone active just gets told.
  let emailQueued: boolean | null = null
  if (user.status === 'invited') {
    emailQueued = (await issueUserInvitation(app, user, actor.id, `You have been added as a project manager on "${project.name}".`)).emailQueued
  } else if (added && app.hasDecorator('notifications')) {
    try {
      await app.notifications.send({
        recipientId: user.id,
        kind: 'project_manager_added',
        title: `You are now a project manager on "${project.name}"`,
        body: 'You have been added as a project manager on this project.',
        linkPath: `/projects/${project.id}`,
        payload: { projectId: project.id },
      })
    } catch (err) {
      app.log.warn({ err, projectId: project.id, userId: user.id }, 'project_manager_added notification failed')
    }
  }

  if (added) {
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'project.manager_added',
      entityType: 'project',
      entityId: project.id,
      details: { projectId: project.id, userId: user.id, email: user.email, status: user.status },
      ipAddress: request.ip ?? null,
    })
  }
  return { added, emailQueued }
}
