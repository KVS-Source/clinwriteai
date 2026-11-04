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

// Who may change a document's content (sections, versions, references, AI
// edits, submit for review): the same people as its RACI — the authors. Admins,
// PMs and every other letter are view-only. The realtime sidecar authenticates
// as a synthetic admin and only relays edits the author's session made.
export async function actorCanEditDocumentContent(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (actor.id === 'system:collab') return true
  return actorCanEditRaciAssignments(prisma, actor, documentId)
}

// Who may add a comment (action table row 15): the document's Author (R),
// Reviewer (C), QC (Q) or Approver (A). Admins, PMs, auditors and Informed (I)
// only read comments. External guests comment through their magic link
// (guest-invitations/redemption.ts), which doesn't use this gate.
const COMMENT_LOCKED_ROLES: ReadonlySet<string> = new Set([...RACI_LOCKED_ROLES, 'auditor', 'read-only', 'guest'])
const COMMENT_LETTERS = ['R', 'C', 'Q', 'A']

export async function actorCanAddComment(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (COMMENT_LOCKED_ROLES.has(actor.role)) return false
  const [doc, row] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true } }),
    prisma.documentRaci.findFirst({
      where: { documentId, userId: actor.id, letter: { in: COMMENT_LETTERS }, removedAt: null },
      select: { id: true },
    }),
  ])
  // The assignee is the document's first Author, before any R row exists.
  return row !== null || (!!doc && doc.assigneeId === actor.id)
}

// Who may post a reviewer verdict (approve / return a section): Reviewer (C),
// QC (Q) or Approver (A) — action table rows 12 and 14. The Author comments
// but never approves or returns their own document.
const VERDICT_LETTERS = ['C', 'Q', 'A']

export async function actorCanGiveVerdict(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (COMMENT_LOCKED_ROLES.has(actor.role)) return false
  const row = await prisma.documentRaci.findFirst({
    where: { documentId, userId: actor.id, letter: { in: VERDICT_LETTERS }, removedAt: null },
    select: { id: true },
  })
  return row !== null
}

export const VERDICT_FORBIDDEN = {
  error: 'verdict_forbidden',
  message: 'Only the Reviewer (C), QC (Q) or Approver (A) on this document can approve or return a section.',
} as const

export const COMMENT_ADD_FORBIDDEN = {
  error: 'comment_forbidden',
  message: 'Only the Author (R), Reviewer (C), QC (Q) or Approver (A) on this document can add comments.',
} as const

export const DOCUMENT_EDIT_FORBIDDEN = {
  error: 'document_edit_forbidden',
  message: 'Only an author (R) on this document can edit it.',
} as const
