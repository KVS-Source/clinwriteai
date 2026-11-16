// Automatic start of the signature chain: once every Approver (A) on a document awaiting signature has
// approved it, the chain starts by itself, with no one having to initiate it.
//
// An Approver's "Approve document" is a whole-document approve verdict (sectionRef 'Document'). It also
// stamps their active A rows documentApprovedAt (not approvedAt: a signature-required row can't carry
// that without a signatureId), which is what this checks, and which a return to authoring clears again
// (resetRaciRound), so every round starts with nobody approved. If a gate blocks the chain
// (an unfinished mandatory checklist item, an empty section), nothing is started, the reason is audited,
// and the Author or an Approver can still start it by hand from the E-Signature screen once it is fixed.

import type { FastifyInstance } from 'fastify'
import { defaultSigners, startSignatureChain } from './start-chain.js'

/** The sectionRef a whole-document approval is stored under (the Approver View's "Approve document"). */
export const APPROVE_DOCUMENT_REF = 'Document'

export async function recordApprovalAndMaybeStartChain(app: FastifyInstance, args: {
  documentId: string
  actorId: string
  ipAddress: string | null
}): Promise<{ chainStarted: boolean; blocked?: unknown }> {
  const { documentId, actorId, ipAddress } = args
  const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) return { chainStarted: false }

  // Only an Approver's own approval counts, and only while the document awaits signature.
  const mine = await app.prisma.documentRaci.updateMany({
    where: { documentId, userId: actorId, letter: 'A', removedAt: null, rejectedAt: null, documentApprovedAt: null },
    data:  { documentApprovedAt: new Date() },
  })
  if (mine.count === 0) return { chainStarted: false }
  if (doc.status !== 'pending_signature') return { chainStarted: false }

  // Everyone named Approver must have approved.
  const approvers = await app.prisma.documentRaci.findMany({
    where:  { documentId, letter: 'A', removedAt: null },
    select: { documentApprovedAt: true },
  })
  if (approvers.length === 0 || approvers.some(a => a.documentApprovedAt === null)) return { chainStarted: false }

  const signers = await defaultSigners(app.prisma, doc)
  const started = await startSignatureChain(app, {
    doc, actorId, ipAddress, chainType: 'grouped', signers, automatic: true,
  })
  if (started.ok) return { chainStarted: true }

  // The chain is already running (a second approval raced this one) — nothing to do.
  if (started.status === 409 && started.body.error === 'chain_already_active') return { chainStarted: false }

  await app.audit.append({
    timestamp:  new Date().toISOString(),
    actorId,
    action:     'signature_auto_start_blocked',
    entityType: 'document',
    entityId:   documentId,
    details:    { status: started.status, reason: started.body },
    ipAddress,
  })
  return { chainStarted: false, blocked: started.body }
}
