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
import { visibleProjectIdsForUser } from '../../projects/visibility.js'

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

// Admins can never hold R or be a document's assignee. A PM can, so that they sign the document as
// its author, though they still can't edit it or manage its RACI (see above).
export const NEVER_AUTHOR_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin'])

// Nor can an auditor (read-only everywhere) or a guest be a document's assignee (CW-081).
export const NEVER_ASSIGNEE_ROLES: ReadonlySet<string> = new Set([...NEVER_AUTHOR_ROLES, 'auditor', 'read-only', 'guest'])

// An unknown id passes here and fails on the Document's foreign key as it always has.
export async function userCanBeAssignee(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return !user || !NEVER_ASSIGNEE_ROLES.has(user.role)
}

export const ASSIGNEE_NOT_ELIGIBLE = {
  error: 'assignee_not_eligible',
  message: 'An admin, auditor or guest cannot be assigned as the author of a document.',
} as const

// Viewing a document's versions and comparing them: an auditor, a PM who can see the project, or the
// document's R (or assignee) or Q. Not its reviewers (C), approvers (A) or Informed, and not admins.
export function actorCanViewVersions(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  return auditorPmOrLetters(prisma, actor, documentId, ['R', 'Q'])
}

// Viewing a document's checklist: the same, plus its reviewers and approvers. Not Informed or a guest.
export function actorCanViewChecklist(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  return auditorPmOrLetters(prisma, actor, documentId, ['R', 'C', 'Q', 'A'])
}

async function auditorPmOrLetters(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string, letters: string[]): Promise<boolean> {
  if (actor.role === 'auditor' || actor.role === 'read-only') return true
  if (NEVER_AUTHOR_ROLES.has(actor.role) || actor.role === 'guest') return false
  const [doc, rows] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true, projectId: true } }),
    prisma.documentRaci.findMany({
      where: { documentId, userId: actor.id, letter: { in: letters }, removedAt: null },
      select: { documentId: true },
    }),
  ])
  if (!doc) return false
  if (actor.role === 'pm') {
    const visible = await visibleProjectIdsForUser(prisma, actor)
    return visible === 'all' || visible.has(doc.projectId)
  }
  return rows.length > 0 || doc.assigneeId === actor.id
}

export const CHECKLIST_VIEW_FORBIDDEN = {
  error: 'checklist_view_forbidden',
  message: "You don't have access to this document's checklist.",
} as const

export const VERSION_VIEW_FORBIDDEN = {
  error: 'version_view_forbidden',
  message: "You don't have access to this document's version history.",
} as const

// Reading comment text, including CRM resolution notes, AI drafts and minutes. Tenant admins can't.
// The permission matrix also leaves out auditors, but that is awaiting the product owner's confirmation.
export function actorCanViewComments(actor: AuthenticatedUser): boolean {
  return !NEVER_AUTHOR_ROLES.has(actor.role)
}

export const COMMENT_VIEW_FORBIDDEN = {
  error: 'comment_view_forbidden',
  message: "You don't have access to this document's comments.",
} as const

// Resolving a comment, in a CRM meeting or outside one: the document's Author (R, or the assignee),
// Reviewer (C) or Approver (A). QC and Informed can't, and a PM, admin, auditor or guest can't even
// when holding a letter. Of the given documents, returns the ones this actor may resolve comments on.
export async function documentsActorCanResolve(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentIds: string[],
): Promise<Set<string>> {
  if (COMMENT_LOCKED_ROLES.has(actor.role) || documentIds.length === 0) return new Set()
  const [rows, assigned] = await Promise.all([
    prisma.documentRaci.findMany({
      where: { documentId: { in: documentIds }, userId: actor.id, letter: { in: ['R', 'C', 'A'] }, removedAt: null },
      select: { documentId: true },
    }),
    prisma.document.findMany({ where: { id: { in: documentIds }, assigneeId: actor.id }, select: { id: true } }),
  ])
  return new Set([...rows.map(r => r.documentId), ...assigned.map(d => d.id)])
}

export async function actorCanResolveComments(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  return (await documentsActorCanResolve(prisma, actor, [documentId])).has(documentId)
}

export const COMMENT_RESOLVE_FORBIDDEN = {
  error: 'comment_resolve_forbidden',
  message: "Only this document's author, reviewer or approver can resolve its comments.",
} as const

// Scheduling a CRM meeting: anyone working on the document (any RACI letter, or the assignee), and a PM
// who can see the project. Never an admin, or someone whose only part on the document is QC (Q).
export async function actorCanScheduleCrm(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  if (NEVER_AUTHOR_ROLES.has(actor.role)) return false
  const [doc, rows] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true, projectId: true } }),
    prisma.documentRaci.findMany({ where: { documentId, userId: actor.id, removedAt: null }, select: { letter: true } }),
  ])
  if (!doc) return false
  if (doc.assigneeId === actor.id) return true
  if (rows.length > 0) return rows.some(r => r.letter !== 'Q')
  if (actor.role !== 'pm') return false
  const visible = await visibleProjectIdsForUser(prisma, actor)
  return visible === 'all' || visible.has(doc.projectId)
}

export const CRM_SCHEDULE_FORBIDDEN = {
  error: 'crm_schedule_forbidden',
  message: "Only the document's participants or a project manager can schedule this meeting. Admins and QC cannot.",
} as const
