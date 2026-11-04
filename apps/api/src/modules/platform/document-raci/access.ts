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
export const RACI_LOCKED_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin', 'pm'])

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

export const DOCUMENT_EDIT_FORBIDDEN = {
  error: 'document_edit_forbidden',
  message: 'Only an author (R) on this document can edit it.',
} as const

// AI Chat (and the inline section AI prompt) is turned off for Project Managers.
// The web hides the entry points; the API refuses the calls so it can't be bypassed.
export const actorCanUseAiChat = (actor: { role: string }): boolean => actor.role !== 'pm'

export const AI_CHAT_FORBIDDEN = {
  error: 'ai_chat_not_allowed',
  message: 'AI Chat is not available to Project Managers.',
} as const

// The assignee is the document's first author. Someone who can't edit or manage RACI can't be
// that, or the new document starts with nobody able to work on it. An unknown id passes here and
// fails on the Document's foreign key as it always has.
export async function userCanBeAssignee(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return !user || !RACI_LOCKED_ROLES.has(user.role)
}

export const ASSIGNEE_NOT_ELIGIBLE = {
  error: 'assignee_not_eligible',
  message: 'A project manager or admin cannot be assigned as the author of a document.',
} as const
