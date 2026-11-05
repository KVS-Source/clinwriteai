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
// RACI is owned by the document's authors: admins, PMs and auditors never edit
// it — nor the document's content — even when they happen to be the assignee
// or hold an R row. Auditors are a view-only role. The checklist / guest /
// signature routes keep actorCanEditDocumentRaci.
export const RACI_LOCKED_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin', 'pm', 'auditor'])

export async function actorCanEditRaciAssignments(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (RACI_LOCKED_ROLES.has(actor.role)) return false
  return actorCanEditDocumentRaci(prisma, actor, documentId)
}

// Who may change a document's content (sections, section locks, versions,
// references, AI edits, submit for review): its authors — an active R row on
// the document, or its assignee. Admins, PMs and every other letter are
// view-only (403). The realtime sidecar gets no exemption: it saves on behalf
// of the author who typed (x-acting-user), so this check runs as that user.
export async function actorCanEditDocumentContent(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
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

// Who may waive an ICH E3 section or remove a waiver (action table row 21): the
// document's Author (R) or QC (Q). The Reviewer (C), Approver (A) and everyone
// else only view the checklist (row 20). The assignee is the first Author.
const ICH_WAIVE_LETTERS = ['R', 'Q']

export async function actorCanWaiveIchSection(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (COMMENT_LOCKED_ROLES.has(actor.role)) return false
  const [doc, row] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true } }),
    prisma.documentRaci.findFirst({
      where: { documentId, userId: actor.id, letter: { in: ICH_WAIVE_LETTERS }, removedAt: null },
      select: { id: true },
    }),
  ])
  return row !== null || (!!doc && doc.assigneeId === actor.id)
}

export const ICH_WAIVE_FORBIDDEN = {
  error: 'ich_waive_forbidden',
  message: 'Only the Author (R) or QC (Q) on this document can waive an ICH E3 section or remove a waiver.',
} as const

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

// Source documents belong to the project, not to one document, so "author" there
// means an author on any of the project's documents: an active R row, or a
// document's assignee (the same rule as actorCanEditDocumentContent, scoped to
// the project). Admins, PMs and auditors never; C, Q, A and I letters are
// view-only. Used to remove a project's source files.
export async function actorIsProjectAuthor(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  projectId: string,
): Promise<boolean> {
  if (RACI_LOCKED_ROLES.has(actor.role) || actor.role === 'guest') return false
  const [rRow, assigned] = await Promise.all([
    prisma.documentRaci.findFirst({
      where: { userId: actor.id, letter: 'R', removedAt: null, document: { projectId, deletedAt: null } },
      select: { id: true },
    }),
    prisma.document.findFirst({ where: { projectId, deletedAt: null, assigneeId: actor.id }, select: { id: true } }),
  ])
  return !!(rRow || assigned)
}

export const SOURCE_EDIT_FORBIDDEN = {
  error: 'source_edit_forbidden',
  message: "Only an author (R) on this project's documents can change its source documents.",
} as const

// Who may see a project's source documents (list, open, download, and the references
// to them): R, C, Q or A on any of its documents (or a document's assignee), its PMs and
// auditors. Admins, Informed and guests never, whatever letters they hold.
const SOURCE_HIDDEN_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin', 'guest'])
const SOURCE_VIEW_LETTERS = ['R', 'C', 'Q', 'A']

const pmOnProject = async (prisma: PrismaClient, actor: AuthenticatedUser, projectId: string) => {
  if (actor.role !== 'pm') return false
  const visible = await visibleProjectIdsForUser(prisma, actor)
  return visible === 'all' || visible.has(projectId)
}

export async function actorCanViewSources(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  projectId: string,
): Promise<boolean> {
  if (SOURCE_HIDDEN_ROLES.has(actor.role)) return false
  if (actor.role === 'auditor' || actor.role === 'read-only') return true
  if (actor.role === 'pm') return pmOnProject(prisma, actor, projectId)
  const [row, assigned] = await Promise.all([
    prisma.documentRaci.findFirst({
      where: { userId: actor.id, letter: { in: SOURCE_VIEW_LETTERS }, removedAt: null, document: { projectId, deletedAt: null } },
      select: { id: true },
    }),
    prisma.document.findFirst({ where: { projectId, deletedAt: null, assigneeId: actor.id }, select: { id: true } }),
  ])
  return !!(row || assigned)
}

export const SOURCE_VIEW_FORBIDDEN = {
  error: 'source_view_forbidden',
  message: "You don't have access to this project's source documents.",
} as const

// Who may add a file to the library: authors, and for now the project's PMs too, who
// need it when creating a document (the source picker and the AI first draft).
export async function actorCanUploadSources(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  projectId: string,
): Promise<boolean> {
  return (await pmOnProject(prisma, actor, projectId)) || actorIsProjectAuthor(prisma, actor, projectId)
}

// Saving or discarding an existing upload is for authors. A PM only gets to finish
// or cancel their own upload; a file already saved to the library is out of their reach.
export async function actorCanChangeSource(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  upload: { projectId: string; status: string; uploadedBy: string },
): Promise<boolean> {
  if (await actorIsProjectAuthor(prisma, actor, upload.projectId)) return true
  return upload.status === 'pending_classification' && upload.uploadedBy === actor.id
    && pmOnProject(prisma, actor, upload.projectId)
}

// AI Chat (and the inline section AI prompt) is for a document's authors only: the
// routes also require actorCanEditDocumentContent. A PM is refused outright, even
// holding R. The web disables the entry points; the API refuses so it can't be bypassed.
export const actorCanUseAiChat = (actor: { role: string }): boolean => actor.role !== 'pm'

export const AI_CHAT_FORBIDDEN = {
  error: 'ai_chat_not_allowed',
  message: "AI Chat is only available to this document's authors.",
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

// Submitting for review is for authors only: each R submits their own part
// (POST /documents/:id/submit-for-review marks their active R rows submitted),
// and the document goes to review once every R has. On a document with no R
// rows yet, its assignee submits it alone. Everyone else is refused.
export const SUBMIT_FORBIDDEN = {
  error: 'submit_forbidden',
  message: 'Only an author (R) on this document can submit it for review.',
} as const

// An author (R) on the document: an active R row, or — on a document with no R
// rows yet — its assignee. The same people who may submit for review; a PM
// holding R counts (they hold R to sign as author). Auditors are a view-only
// role and admins can never hold R. Used for author-only actions that aren't
// content edits, such as nudging the pending cohort.
export async function actorIsDocumentAuthor(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  if (actor.role === 'auditor' || NEVER_AUTHOR_ROLES.has(actor.role)) return false
  const [doc, rows] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true } }),
    prisma.documentRaci.findMany({ where: { documentId, letter: 'R', removedAt: null }, select: { userId: true } }),
  ])
  if (!doc) return false
  if (rows.some(r => r.userId === actor.id)) return true
  return rows.length === 0 && doc.assigneeId === actor.id
}

export const NUDGE_FORBIDDEN = {
  error: 'nudge_forbidden',
  message: 'Only an author (R) on this document can nudge the people it is waiting on.',
} as const

// Back to authoring (a C, Q or A returning it, a reviewer / CRM bounce, a signer
// refusal) starts a new round on the new version: every author submits their part
// again, and every reviewer, QC and approver reviews / approves the revised document
// again. Clears each active row's completion (submittedAt / reviewedAt / approvedAt
// and the completion signature) and any rejection, so no one is stuck as "rejected"
// and no earlier verdict carries over. rejectionNote is kept as the reason last given.
// Accepts the client or a transaction.
export async function resetRaciRound(
  db: { documentRaci: Pick<PrismaClient['documentRaci'], 'updateMany'> },
  documentId: string,
): Promise<void> {
  await db.documentRaci.updateMany({
    where: { documentId, removedAt: null },
    data: { submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null },
  })
}

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
