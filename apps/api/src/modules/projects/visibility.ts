// Project visibility — which projects a given user is allowed to see.
//
// Rule (docs/roles-and-permissions.md §3):
//   tenant-admin | admin (legacy) | auditor | super-admin (legacy)
//                                             → see every project (returns 'all')
//   everyone else → union of:
//     - ProjectMember row with removedAt null                      (new RBAC)
//     - ProjectTeamMember row                                      (legacy)
//     - DocumentRaci row with removedAt null on any Document in the project
//       (or being that Document's assignee / creator)
//     - a project-level RACI letter (RaciAssignment: R, A, C or I on any activity)
//
// Working as PM vs not (a user holding PM + Contributor works as one at a time — auth/active-role.ts):
//   - The "Project Manager" membership (the project's creator, or a PM added to it) shows the project
//     only while the user works as PM. Working as Contributor they see a project they manage only if
//     they also hold a RACI role there (document or project level) or another membership.
//   - Likewise, having created a document in a project counts only for a PM (a PM sets documents up
//     for others); a Contributor needs to be its assignee or hold a RACI letter on it.
//
// Why three sources: migration 47 added ProjectMember + DocumentRaci on top
// of the existing ProjectTeamMember table. Both old and new rows co-exist
// through the cutover (per the schema comment at platform.prisma §133),
// so visibility has to consider both or legacy demo seeds disappear from
// contributors' lists.
//
// Guests are intentionally NOT bypassed here — they get visibility via
// GuestInvitation when it becomes a routed concern. For today they only
// see projects that already appear via one of the three signals above
// (because the guest-invite seed also writes a ProjectMember row).

import type { Prisma, PrismaClient } from '@prisma/client'
import { hasAnyRole, type AuthenticatedUser } from '../../auth/rbac.js'

/** ProjectMember.projectRole written for the creating PM and for PMs added to a project. */
export const PM_PROJECT_ROLE = 'Project Manager'

const SEE_ALL_ROLES: ReadonlySet<string> = new Set([
  'tenant-admin',
  'admin',           // legacy alias
  'super-admin',     // legacy alias
  'auditor',
  'qc',              // QC reads all content, like an auditor
  'read-only',       // legacy alias of auditor
])

/** True for roles that see every project and document (admins, auditors): no per-record lookup needed. */
export function seesEverything(user: AuthenticatedUser): boolean {
  return hasAnyRole(user, ...SEE_ALL_ROLES)
}

/**
 * Returns the set of project ids this user may see, or the sentinel 'all'
 * when the user bypasses scoping (admins + auditors).
 */
export async function visibleProjectIdsForUser(
  prisma: PrismaClient,
  user: AuthenticatedUser,
): Promise<'all' | Set<string>> {
  if (hasAnyRole(user, ...SEE_ALL_ROLES)) return 'all'
  const asPm = hasAnyRole(user, 'pm')

  const [members, legacyTeam, raciDocs, projectRaci] = await Promise.all([
    prisma.projectMember.findMany({
      where: {
        userId: user.id,
        removedAt: null,
        // Not working as PM: the PM membership doesn't count (see the rule above).
        ...(asPm ? {} : { OR: [{ projectRole: null }, { projectRole: { not: PM_PROJECT_ROLE } }] }),
      },
      select: { projectId: true },
    }),
    prisma.projectTeamMember.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    }),
    prisma.document.findMany({
      where: {
        deletedAt: null,
        // Same "works on" test as documentVisibilityWhere below.
        OR: [
          { assigneeId: user.id },
          ...(asPm ? [{ createdBy: user.id }] : []),
          { raciRows: { some: { userId: user.id, removedAt: null } } },
        ],
      },
      select: { projectId: true },
      distinct: ['projectId'],
    }),
    // Project-level RACI (/projects/:id/raci).
    prisma.raciAssignment.findMany({
      where: {
        OR: [
          { responsibleId: user.id },
          { accountableId: user.id },
          { consultedIds: { has: user.id } },
          { informedIds: { has: user.id } },
        ],
      },
      select: { projectId: true },
      distinct: ['projectId'],
    }),
  ])

  const ids = new Set<string>()
  for (const r of members)    ids.add(r.projectId)
  for (const r of legacyTeam) ids.add(r.projectId)
  for (const r of raciDocs)   ids.add(r.projectId)
  for (const r of projectRaci) ids.add(r.projectId)
  return ids
}

// Document visibility — inside a visible project, which documents a user sees.
//
//   tenant-admin | admin | auditor (SEE_ALL_ROLES) and pm → every document
//   everyone else → only documents they work on:
//     - the document's assignee
//     - an active DocumentRaci row (any letter)
//     - the document's creator (so a writer who sets up a document for
//       someone else doesn't lose it the moment it's created)
const SEE_ALL_DOCUMENT_ROLES: ReadonlySet<string> = new Set([...SEE_ALL_ROLES, 'pm'])

/** Prisma filter limiting documents to the ones `user` works on, or null when they see all. */
export function documentVisibilityWhere(user: AuthenticatedUser): Prisma.DocumentWhereInput | null {
  if (hasAnyRole(user, ...SEE_ALL_DOCUMENT_ROLES)) return null
  return {
    OR: [
      { assigneeId: user.id },
      { createdBy: user.id },
      { raciRows: { some: { userId: user.id, removedAt: null } } },
    ],
  }
}

/**
 * Whether `user` may open the document (existence is the caller's concern).
 *
 *   admin | auditor → yes
 *   contributor     → only documents they work on (documentVisibilityWhere); working on a
 *                     document is itself what makes its project visible to them
 *   pm              → every document, but only inside a project they can see. Without this a
 *                     PM could open any document of any project by pasting its id (CW-020).
 *
 * requireAuth runs this for every route with a :documentId parameter, so a new document route
 * is covered without remembering to call it.
 */
export async function canSeeDocument(prisma: PrismaClient, user: AuthenticatedUser, documentId: string): Promise<boolean> {
  if (hasAnyRole(user, ...SEE_ALL_ROLES)) return true
  const scope = documentVisibilityWhere(user)
  if (scope) return (await prisma.document.count({ where: { id: documentId, ...scope } })) > 0
  const projects = await visibleProjectIdsForUser(prisma, user)
  if (projects === 'all') return true
  if (projects.size === 0) return false
  return (await prisma.document.count({ where: { id: documentId, projectId: { in: [...projects] } } })) > 0
}

/**
 * Which of `documentIds` the user may open — canSeeDocument for a whole list in one query (the
 * Master Library asks it for a page of source documents). Same rules as canSeeDocument.
 */
export async function visibleDocumentIds(prisma: PrismaClient, user: AuthenticatedUser, documentIds: string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  if (hasAnyRole(user, ...SEE_ALL_ROLES)) return new Set(documentIds)
  const scope = documentVisibilityWhere(user)
  let projectFilter: Prisma.DocumentWhereInput = {}
  if (!scope) {
    const projects = await visibleProjectIdsForUser(prisma, user)
    if (projects !== 'all') {
      if (projects.size === 0) return new Set()
      projectFilter = { projectId: { in: [...projects] } }
    }
  }
  const rows = await prisma.document.findMany({ where: { id: { in: documentIds }, ...(scope ?? {}), ...projectFilter }, select: { id: true } })
  return new Set(rows.map(r => r.id))
}
