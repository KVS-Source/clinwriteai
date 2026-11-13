// Who may do what with a document's signature chain — the e-signature action table:
//
//   start a chain       Author (R) or Approver (A) on the document. Never admin, PM, auditor or guest.
//   cancel a chain      the document's Author (R), or the person who started it.
//   read the record     anyone holding a RACI letter on the document, a PM who can see the project,
//                       or an auditor. Never a tenant admin or a guest.
//   export audit trail  PM or auditor (reading is the same as "read the record").
//   sign                only the person named on that step (checked in routes.ts, not here).
//
// A person with two platform roles (Project manager + Contributor, or Project manager + Auditor —
// auth/role-combos.ts) gets the union: a role restriction here applies only when every role they hold
// is restricted. An admin role is never combined, so an admin never starts a chain or signs.

import type { PrismaClient } from '@prisma/client'
import { hasAnyRole, onlyRolesIn, type AuthenticatedUser } from '../../../auth/rbac.js'
import { actorCanEditRaciAssignments } from '../../platform/document-raci/access.js'
import { visibleProjectIdsForUser } from '../../projects/visibility.js'

export type SignatureMeaning = 'authored' | 'reviewed' | 'approved' | 'acknowledged'

/** The RACI letters whose holders must sign, and the meaning each one signs with. */
export const SIGNER_LETTERS = {
  R: 'authored',
  C: 'reviewed',
  A: 'approved',
  I: 'acknowledged',
} as const satisfies Record<string, SignatureMeaning>

const ADMIN_ROLES: ReadonlySet<string> = new Set(['tenant-admin', 'admin', 'super-admin'])
const AUDITOR_ROLES: ReadonlySet<string> = new Set(['auditor', 'read-only', 'qc'])   // QC reads like an auditor

type DocRef = { id: string; projectId: string; assigneeId?: string | null }

/** Author (R) or Approver (A) on the document. */
export async function actorCanStartChain(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  if (onlyRolesIn(actor, [...ADMIN_ROLES, ...AUDITOR_ROLES, 'pm', 'guest'])) return false
  // R: an active R row, or the document's original assignee (excludes admins and PMs).
  if (await actorCanEditRaciAssignments(prisma, actor, documentId)) return true
  const approver = await prisma.documentRaci.findFirst({
    where: { documentId, userId: actor.id, letter: 'A', removedAt: null },
    select: { id: true },
  })
  return approver !== null
}

/** The document's Author (R), or whoever started the chain. */
export async function actorCanCancelChain(
  prisma: PrismaClient, actor: AuthenticatedUser, chain: { initiatedBy: string; documentId: string },
): Promise<boolean> {
  if (chain.initiatedBy === actor.id) return true
  return actorCanEditRaciAssignments(prisma, actor, chain.documentId)
}

/** Read the signature record or the document's audit trail. */
export async function actorCanReadDocumentRecord(prisma: PrismaClient, actor: AuthenticatedUser, doc: DocRef): Promise<boolean> {
  if (onlyRolesIn(actor, [...ADMIN_ROLES, 'guest'])) return false
  if (hasAnyRole(actor, ...AUDITOR_ROLES)) return true
  if (hasAnyRole(actor, 'pm')) {
    const visible = await visibleProjectIdsForUser(prisma, actor)
    if (visible === 'all' || visible.has(doc.projectId)) return true
  }
  if (doc.assigneeId && doc.assigneeId === actor.id) return true
  const row = await prisma.documentRaci.findFirst({
    where: { documentId: doc.id, userId: actor.id, removedAt: null },
    select: { id: true },
  })
  return row !== null
}

/** Export the document's audit trail: a PM or an auditor who can read it. */
// Final Document: the same people as the record (above), except QC (Q) on its own,
// which has no access to the Final Document for now (pending the SME's answer).
// Mirrors canViewFinal in apps/web/src/screens/output/useSignatureAccess.ts, so
// the screen the UI hides is also refused by the API.
export async function actorCanReadFinalDocument(prisma: PrismaClient, actor: AuthenticatedUser, doc: DocRef): Promise<boolean> {
  if (!(await actorCanReadDocumentRecord(prisma, actor, doc))) return false
  if (doc.assigneeId && doc.assigneeId === actor.id) return true
  const rows = await prisma.documentRaci.findMany({
    where: { documentId: doc.id, userId: actor.id, removedAt: null },
    select: { letter: true },
  })
  const onlyQc = rows.length > 0 && rows.every(r => r.letter === 'Q')
  return !onlyQc
}

export const FINAL_DOCUMENT_FORBIDDEN = {
  error: 'final_document_forbidden',
  message: "You don't have access to this document's Final Document.",
} as const

export async function actorCanExportDocumentAudit(prisma: PrismaClient, actor: AuthenticatedUser, doc: DocRef): Promise<boolean> {
  if (!hasAnyRole(actor, 'pm', ...AUDITOR_ROLES)) return false
  return actorCanReadDocumentRecord(prisma, actor, doc)
}

export interface RequiredSigner {
  userId: string
  name: string
  /** Meanings this person may sign with (one per letter they hold; normally exactly one). */
  meanings: Set<SignatureMeaning>
}

/**
 * Everyone who must sign: each active Author (R), Reviewer (C), Approver (A) and Informed (I) on the
 * document's RACI, plus the project team's Approvers. A person with two letters appears once.
 */
export async function requiredSigners(prisma: PrismaClient, doc: { id: string; projectId: string }): Promise<RequiredSigner[]> {
  const [raciRows, teamApprovers] = await Promise.all([
    prisma.documentRaci.findMany({
      where: { documentId: doc.id, removedAt: null, letter: { in: Object.keys(SIGNER_LETTERS) } },
      select: { userId: true, letter: true },
    }),
    prisma.projectTeamMember.findMany({
      where: { projectId: doc.projectId, raci: 'A' },
      select: { userId: true, name: true },
    }),
  ])
  const byId = new Map<string, RequiredSigner>()
  const add = (userId: string, meaning: SignatureMeaning, name?: string) => {
    const cur = byId.get(userId) ?? { userId, name: name ?? userId, meanings: new Set<SignatureMeaning>() }
    cur.meanings.add(meaning)
    if (name && cur.name === userId) cur.name = name
    byId.set(userId, cur)
  }
  for (const r of raciRows) add(r.userId, SIGNER_LETTERS[r.letter as keyof typeof SIGNER_LETTERS])
  for (const t of teamApprovers) add(t.userId, 'approved', t.name)

  const unnamed = [...byId.values()].filter(s => s.name === s.userId).map(s => s.userId)
  if (unnamed.length > 0) {
    const users = await prisma.user.findMany({ where: { id: { in: unnamed } }, select: { id: true, name: true } })
    for (const u of users) { const s = byId.get(u.id); if (s) s.name = u.name }
  }
  return [...byId.values()]
}
