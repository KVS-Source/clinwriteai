// Project visibility — which projects a given user is allowed to see.
//
// Rule (docs/roles-and-permissions.md §3):
//   tenant-admin | admin (legacy) | auditor | super-admin (legacy)
//                                             → see every project (returns 'all')
//   everyone else → union of:
//     - ProjectMember row with removedAt null                      (new RBAC)
//     - ProjectTeamMember row                                      (legacy)
//     - DocumentRaci row with removedAt null on any Document in the project
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

import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../auth/rbac.js'

const SEE_ALL_ROLES: ReadonlySet<string> = new Set([
  'tenant-admin',
  'admin',           // legacy alias
  'super-admin',     // legacy alias
  'auditor',
  'read-only',       // legacy alias of auditor
])

/**
 * Returns the set of project ids this user may see, or the sentinel 'all'
 * when the user bypasses scoping (admins + auditors).
 */
export async function visibleProjectIdsForUser(
  prisma: PrismaClient,
  user: AuthenticatedUser,
): Promise<'all' | Set<string>> {
  if (SEE_ALL_ROLES.has(user.role)) return 'all'

  const [members, legacyTeam, raciDocs] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId: user.id, removedAt: null },
      select: { projectId: true },
    }),
    prisma.projectTeamMember.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    }),
    prisma.document.findMany({
      where: {
        deletedAt: null,
        raciRows: { some: { userId: user.id, removedAt: null } },
      },
      select: { projectId: true },
      distinct: ['projectId'],
    }),
  ])

  const ids = new Set<string>()
  for (const r of members)    ids.add(r.projectId)
  for (const r of legacyTeam) ids.add(r.projectId)
  for (const r of raciDocs)   ids.add(r.projectId)
  return ids
}
