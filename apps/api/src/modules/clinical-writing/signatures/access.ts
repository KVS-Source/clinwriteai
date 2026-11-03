// Who may do what with a document's signature chain — the e-signature action table:
//
//   start a chain       Author (R) or Approver (A) on the document. Never admin, PM, auditor or guest.
//   cancel a chain      the document's Author (R), or the person who started it.
//   read the record     anyone holding a RACI letter on the document, a PM who can see the project,
//                       or an auditor. Never a tenant admin or a guest.
//   export audit trail  PM or auditor (reading is the same as "read the record").
//   sign                only the person named on that step (checked in routes.ts, not here).
//
// Dual roles (one person holding two letters, e.g. a PM who is also an Author) are out of scope: the
// RACI check below already treats a PM or admin as never an Author.

import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
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
const AUDITOR_ROLES: ReadonlySet<string> = new Set(['auditor', 'read-only'])

type DocRef = { id: string; projectId: string; assigneeId?: string | null }

/** Author (R) or Approver (A) on the document. */
export async function actorCanStartChain(prisma: PrismaClient, actor: AuthenticatedUser, documentId: string): Promise<boolean> {
  if (ADMIN_ROLES.has(actor.role) || AUDITOR_ROLES.has(actor.role) || actor.role === 'pm' || actor.role === 'guest') return false
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
  if (ADMIN_ROLES.has(actor.role) || actor.role === 'guest') return false
  if (AUDITOR_ROLES.has(actor.role)) return true
  if (actor.role === 'pm') {
    const visible = await visibleProjectIdsForUser(prisma, actor)
    return visible === 'all' || visible.has(doc.projectId)
  }
  if (doc.assigneeId && doc.assigneeId === actor.id) return true
  const row = await prisma.documentRaci.findFirst({
    where: { documentId: doc.id, userId: actor.id, removedAt: null },
    select: { id: true },
  })
  return row !== null
}

/** Export the document's audit trail: a PM or an auditor who can read it. */
export async function actorCanExportDocumentAudit(prisma: PrismaClient, actor: AuthenticatedUser, doc: DocRef): Promise<boolean> {
  if (actor.role !== 'pm' && !AUDITOR_ROLES.has(actor.role)) return false
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
