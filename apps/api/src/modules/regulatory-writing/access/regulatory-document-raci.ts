// Regulatory document RACI access helpers — Phase M-D.5.
//
// Module D doesn't yet have a dedicated contributor table, so RACI is
// modelled from the fields that exist on RegulatoryDocument + the
// surrounding super-reviewer table:
//
//   - owner (RegulatoryDocument.ownerId)   → R + A (edit, comment, resolve)
//   - SuperReviewer rows for the parent
//     submission                           → C   (comment + resolve own)
//   - tenant-admin / admin / super-admin   → always allowed
//   - pm (project manager) scoped to proj  → edit (parity with other modules)
//   - everyone else with Module D access   → read-only
//
// Keeps the gate shape identical to Modules B/C.

import type { PrismaClient } from '@prisma/client'
import { hasAnyRole, type AuthenticatedUser } from '../../../auth/rbac.js'

export const REG_DOC_EDIT_FORBIDDEN = {
  error:   'regulatory_document_edit_forbidden',
  message: 'Only the document owner (or PM / admin) may edit this item.',
} as const

export const REG_DOC_COMMENT_FORBIDDEN = {
  error:   'regulatory_document_comment_forbidden',
  message: 'Only the owner, super-reviewers on the parent submission, scoped PM, or admin may comment on this document.',
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

/** Who may edit regulatory document content (section HTML, locks, AI
 *  draft trigger, section rewrite): owner, admins, scoped PM. */
export async function actorCanEditRegulatoryDocument(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  regulatoryDocumentId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const doc = await prisma.regulatoryDocument.findUnique({
    where:  { id: regulatoryDocumentId },
    select: { ownerId: true, projectId: true },
  })
  if (!doc) return false

  if (doc.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, doc.projectId)) return true

  return false
}

/** Who may comment on a regulatory document: owner, project members
 *  with a regulatory-writing role, scoped PM, admin. Project members
 *  without a regulatory role are read-only. */
export async function actorCanCommentOnRegulatoryDocument(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  regulatoryDocumentId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const doc = await prisma.regulatoryDocument.findUnique({
    where:  { id: regulatoryDocumentId },
    select: { ownerId: true, projectId: true },
  })
  if (!doc) return false

  if (doc.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, doc.projectId)) return true

  // Project membership + a regulatory-flavored role acts as C.
  if (hasAnyRole(actor, 'regulatory-lead', 'regulatory-writer', 'reviewer')) {
    const member = await prisma.projectMember.findFirst({
      where:  { projectId: doc.projectId, userId: actor.id },
      select: { id: true },
    })
    if (member) return true
  }

  return false
}
