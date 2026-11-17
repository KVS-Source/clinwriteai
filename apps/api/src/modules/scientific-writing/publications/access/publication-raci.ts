// Publication RACI access helpers — Phase M-B.5.
//
// Mirror of apps/api/src/modules/platform/document-raci/access.ts
// scoped to PublicationAuthor.raci. Letters:
//   - R (Responsible) + A (Accountable) — may edit content, start AI
//     draft, run ai-suggest, acquire section locks, comment, resolve.
//   - C (Consulted) — may comment but not edit content. Read-only on
//     content endpoints.
//   - I (Informed) — read-only on everything content-ish.
//
// Platform roles:
//   - tenant-admin / admin — always allowed (same exception Module A
//     grants for operators).
//   - pm (project manager) — allowed on publications in a project
//     they manage. Read-only on others.
//   - auditor / read-only / guest — view only.

import type { PrismaClient } from '@prisma/client'
import { hasAnyRole, type AuthenticatedUser } from '../../../../auth/rbac.js'

export const PUBLICATION_EDIT_FORBIDDEN = {
  error:   'publication_edit_forbidden',
  message: 'You do not have the author role (R or A) on this publication.',
} as const

export const PUBLICATION_COMMENT_FORBIDDEN = {
  error:   'publication_comment_forbidden',
  message: 'Only R / A / C authors (or PM / admin) can comment on this publication.',
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

/** Author row for `actor` on this publication (null when not an author).
 *  Matches by userId; externals have no User row so their raci is only
 *  reachable via the external-author path (out of scope for this gate). */
async function authorRow(prisma: PrismaClient, actor: AuthenticatedUser, publicationId: string) {
  return prisma.publicationAuthor.findFirst({
    where:  { publicationId, userId: actor.id, removedAt: null },
    select: { id: true, raci: true },
  })
}

/** Who may change publication content (section HTML, locks, AI draft
 *  trigger, section rewrite): R + A authors, admins, and PM scoped to
 *  the project. Everyone else returns false. */
export async function actorCanEditPublicationContent(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  publicationId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const pub = await prisma.publication.findUnique({
    where:  { id: publicationId },
    select: { projectId: true },
  })
  if (!pub) return false

  if (await pmHasProjectAccess(prisma, actor, pub.projectId)) return true

  const row = await authorRow(prisma, actor, publicationId)
  return row?.raci === 'R' || row?.raci === 'A'
}

/** Who may add a comment: R / A / C authors + admins + scoped PM. I
 *  authors and auditors are read-only on comments (same reading access
 *  as the editor surface). */
export async function actorCanCommentOnPublication(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  publicationId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const pub = await prisma.publication.findUnique({
    where:  { id: publicationId },
    select: { projectId: true },
  })
  if (!pub) return false

  if (await pmHasProjectAccess(prisma, actor, pub.projectId)) return true

  const row = await authorRow(prisma, actor, publicationId)
  return row?.raci === 'R' || row?.raci === 'A' || row?.raci === 'C'
}
