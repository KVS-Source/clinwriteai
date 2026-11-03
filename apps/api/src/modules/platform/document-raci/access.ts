// Shared "who can edit things on this document" helper.
//
// Per docs/roles-and-permissions.md §5a: the R on a document owns the
// RACI editor, guest invitations, and the checklist. This helper is used
// by every endpoint that needs that gate so the rule lives in one place.
//
// Allowed (checklist / guests / signatures; RACI edits use the stricter
// actorCanEditRaciAssignments below, which excludes admins and PMs):
//   - tenant-admin (and legacy 'admin')
//   - any user holding letter 'R' on the document in an active row
//   - the Document.assigneeId user (bootstrap path: before the first R
//     row exists on a brand-new doc)

import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

export async function actorCanEditDocumentRaci(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (actor.role === 'tenant-admin' || actor.role === 'admin') return true

  const [doc, existingR] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true } }),
    prisma.documentRaci.findFirst({
      where: {
        documentId,
        userId: actor.id,
        letter: 'R',
        removedAt: null,
      },
      select: { id: true },
    }),
  ])
  if (existingR) return true
  if (doc && doc.assigneeId === actor.id) return true
  return false
}

// Stricter gate for changing a document's RACI assignments themselves
// (add / remove / signature settings, and the panel's can-edit probe).
// RACI is owned by the document's authors: admins and PMs never edit it,
// even when they happen to be the assignee or hold an R row. The
// checklist / guest / signature routes keep actorCanEditDocumentRaci.
const RACI_LOCKED_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin', 'pm'])

export async function actorCanEditRaciAssignments(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (RACI_LOCKED_ROLES.has(actor.role)) return false
  return actorCanEditDocumentRaci(prisma, actor, documentId)
}
