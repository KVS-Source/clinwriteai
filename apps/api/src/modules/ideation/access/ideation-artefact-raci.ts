// Ideation artefact RACI access helpers — Phase M-E.5.
//
// Models the four letters off the fields that exist on IdeationArtefact
// + the parent IdeationProject:
//
//   - owner (IdeationArtefact.ownerId)      → R + A (edit, comment, resolve)
//   - scoped PM on parent project           → edit + comment
//   - project members with a KOL / medical
//     affairs / content role                → C (comment only)
//   - tenant-admin / admin / super-admin    → always allowed
//   - everyone else with Module E access    → read-only

import type { PrismaClient } from '@prisma/client'
import { hasAnyRole, type AuthenticatedUser } from '../../../auth/rbac.js'

export const IDEATION_ARTEFACT_EDIT_FORBIDDEN = {
  error:   'ideation_artefact_edit_forbidden',
  message: 'Only the artefact owner (or scoped PM / admin) may edit this artefact.',
} as const

export const IDEATION_ARTEFACT_COMMENT_FORBIDDEN = {
  error:   'ideation_artefact_comment_forbidden',
  message: 'Only the owner, project reviewers, scoped PM, or admin may comment on this artefact.',
} as const

async function pmHasProjectAccess(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  projectId: string,
): Promise<boolean> {
  if (!hasAnyRole(actor, 'pm')) return false
  const member = await prisma.projectMember.findFirst({
    where:  { projectId, userId: actor.id },
    select: { id: true },
  })
  return member !== null
}

async function resolveProjectId(
  prisma: PrismaClient,
  ideationArtefactId: string,
): Promise<{ ownerId: string | null; projectId: string } | null> {
  const row = await prisma.ideationArtefact.findUnique({
    where:  { id: ideationArtefactId },
    select: { ownerId: true, ideationProjectId: true },
  })
  if (!row) return null
  const parent = await prisma.ideationProject.findUnique({
    where: { id: row.ideationProjectId }, select: { projectId: true },
  })
  if (!parent) return null
  return { ownerId: row.ownerId, projectId: parent.projectId }
}

export async function actorCanEditIdeationArtefact(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  ideationArtefactId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true
  const scope = await resolveProjectId(prisma, ideationArtefactId)
  if (!scope) return false
  if (scope.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, scope.projectId)) return true
  return false
}

export async function actorCanCommentOnIdeationArtefact(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  ideationArtefactId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true
  const scope = await resolveProjectId(prisma, ideationArtefactId)
  if (!scope) return false
  if (scope.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, scope.projectId)) return true
  if (hasAnyRole(actor, 'kol-manager', 'medical-affairs', 'content-reviewer', 'reviewer')) {
    const member = await prisma.projectMember.findFirst({
      where:  { projectId: scope.projectId, userId: actor.id },
      select: { id: true },
    })
    if (member) return true
  }
  return false
}
