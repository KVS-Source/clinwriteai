// Automatic start of the signature chain: when every Reviewer has finished reviewing, the document reaches
// pending_signature (a CRM meeting is not required) and its chain starts by itself, in the approvers_first order:
//   1. every Approver (A), in parallel — each approves and signs in one step ("Approve & E-sign");
//   2. once the last Approver has signed: every Author (R), Reviewer (C) and Informed (I), in parallel,
//      each told it is their turn.
// The chain never starts earlier: not while a Reviewer is still reviewing.
//
// If a gate blocks the chain (an unfinished mandatory checklist item, an empty section), nothing is
// started, the reason is audited, and the Author or an Approver can start it by hand from the E-Signature
// screen once it is fixed.

import type { FastifyInstance } from 'fastify'
import { defaultSigners, startSignatureChain } from './start-chain.js'

/** The sectionRef an Approver's whole-document approval is stored under. */
export const APPROVE_DOCUMENT_REF = 'Document'

export async function startChainWhenReviewDone(app: FastifyInstance, args: {
  documentId: string
  actorId: string
  ipAddress: string | null
}): Promise<{ chainStarted: boolean; blocked?: unknown }> {
  const { documentId, actorId, ipAddress } = args
  const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
  if (!doc || doc.status !== 'pending_signature') return { chainStarted: false }

  const signers = await defaultSigners(app.prisma, doc)
  const started = await startSignatureChain(app, {
    doc, actorId, ipAddress, chainType: 'approvers_first', signers, automatic: true, skipContentCheck: true,
  })
  if (started.ok) return { chainStarted: true }

  // The chain is already running — nothing to do.
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
