// Signature chain progression — pure helpers.
//
// Extracted from signatures/routes.ts so the state-machine math can
// be unit-tested without the Prisma + Fastify + audit side-effects.
// Routes still own the transactional writes; this file owns the "given
// a chain of N records, what is the next state after step K signs?"
// logic.
//
// Three questions the helpers answer:
//   1. canSign(record, chain) — may this record sign right now?
//   2. nextAwaitingStep(records) — which step should transition queued →
//      awaiting after the just-signed step?
//   3. chainAfterSign(records, step) — is the whole chain complete?
//
// Shapes mirror the Prisma rows but kept narrow so test fixtures don't
// have to construct full relations.

export type SignatureStatus = 'queued' | 'awaiting' | 'signed' | 'declined' | 'expired'
export type ChainStatus     = 'in_progress' | 'complete' | 'cancelled'
export type ChainType       = 'sequential' | 'parallel'

export interface SignatureRecordLite {
  id:     string
  step:   number
  status: SignatureStatus
  signerId: string
}

export interface SignatureChainLite {
  chainType: ChainType
  status:    ChainStatus
}

export type CanSignDenial =
  | { ok: true }
  | { ok: false; reason: 'already_signed' | 'not_awaiting' | 'chain_closed' | 'wrong_signer' }

export function canSign(
  record: SignatureRecordLite,
  chain:  SignatureChainLite,
  signerId: string,
): CanSignDenial {
  if (record.signerId !== signerId) return { ok: false, reason: 'wrong_signer' }
  if (record.status === 'signed')   return { ok: false, reason: 'already_signed' }
  if (record.status !== 'awaiting') return { ok: false, reason: 'not_awaiting' }
  if (chain.status !== 'in_progress') return { ok: false, reason: 'chain_closed' }
  return { ok: true }
}

/**
 * After `signedStep` has signed in a sequential chain, which record (if
 * any) should transition from queued → awaiting next? Returns null for
 * parallel chains (all awaiting at once) or when there is no next step.
 */
export function nextAwaitingStep(
  records: ReadonlyArray<SignatureRecordLite>,
  chainType: ChainType,
  signedStep: number,
): SignatureRecordLite | null {
  if (chainType !== 'sequential') return null
  return records.find(r => r.step === signedStep + 1) ?? null
}

/**
 * After a signature lands, compute whether the whole chain is complete.
 * Caller supplies the record list AS IT WILL LOOK AFTER THE UPDATE —
 * i.e. the just-signed record's status is already 'signed'.
 */
export function chainCompleteAfterSign(records: ReadonlyArray<SignatureRecordLite>): boolean {
  return records.every(r => r.status === 'signed')
}

/**
 * Convenience: given the record list after a sign operation, return
 * the chain status it should land on + whether the document itself
 * should flip to signed.
 */
export function chainStateAfterSign(records: ReadonlyArray<SignatureRecordLite>): {
  chainStatus: ChainStatus
  flipDocumentToSigned: boolean
} {
  if (chainCompleteAfterSign(records)) {
    return { chainStatus: 'complete', flipDocumentToSigned: true }
  }
  return { chainStatus: 'in_progress', flipDocumentToSigned: false }
}
