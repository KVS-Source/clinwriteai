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
export type ChainType       = 'sequential' | 'parallel' | 'grouped'

export interface SignatureRecordLite {
  id:     string
  step:   number
  status: SignatureStatus
  signerId: string
  /** What this person signs as; decides their group in a grouped chain. */
  meaning?: string
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

// ---------------------------------------------------------------------------
// Grouped chains: everyone in a group signs at once, and a group is released only when the group before
// it has fully signed. The order of the groups is the order of the meanings below:
// Authors, then Reviewers, then Approvers, then Informed.
// ---------------------------------------------------------------------------

export const SIGNING_GROUPS = ['authored', 'reviewed', 'approved', 'acknowledged'] as const

/** The position of a meaning's group (0 = first to sign). An unknown meaning goes last. */
export function signingGroup(meaning: string | undefined): number {
  const i = SIGNING_GROUPS.indexOf(meaning as (typeof SIGNING_GROUPS)[number])
  return i === -1 ? SIGNING_GROUPS.length : i
}

/**
 * The signers in the order the chain stores them (this decides each person's step number). Grouped
 * chains put the groups in order and keep the submitted order inside a group; the other types keep the
 * submitted order untouched.
 */
export function sortForChain<T extends { meaning: string }>(signers: ReadonlyArray<T>, chainType: ChainType): T[] {
  if (chainType !== 'grouped') return [...signers]
  return signers
    .map((s, i) => ({ s, i }))
    .sort((a, b) => signingGroup(a.s.meaning) - signingGroup(b.s.meaning) || a.i - b.i)
    .map(x => x.s)
}

/** Who is awaiting at the start. Sequential: the first. Parallel: everyone. Grouped: the whole first group. */
export function initialStatuses(chainType: ChainType, signers: ReadonlyArray<{ meaning: string }>): Array<'awaiting' | 'queued'> {
  if (chainType === 'parallel') return signers.map(() => 'awaiting')
  if (chainType === 'sequential') return signers.map((_, i) => (i === 0 ? 'awaiting' : 'queued'))
  const first = Math.min(...signers.map(s => signingGroup(s.meaning)))
  return signers.map(s => (signingGroup(s.meaning) === first ? 'awaiting' : 'queued'))
}

/**
 * The records that move from queued to awaiting after `signedId` signs. `records` must already show the
 * just-signed record as signed. Sequential: the next step. Parallel: none. Grouped: when the signed
 * person's group is complete, every queued record of the next group that has anyone queued.
 */
export function recordsToRelease(
  records: ReadonlyArray<SignatureRecordLite>,
  chainType: ChainType,
  signedId: string,
): SignatureRecordLite[] {
  const signed = records.find(r => r.id === signedId)
  if (!signed || chainType === 'parallel') return []
  if (chainType === 'sequential') {
    const next = records.find(r => r.step === signed.step + 1)
    return next && next.status === 'queued' ? [next] : []
  }
  const group = signingGroup(signed.meaning)
  if (records.some(r => signingGroup(r.meaning) === group && r.status !== 'signed')) return []
  const queued = records.filter(r => r.status === 'queued' && signingGroup(r.meaning) > group)
  if (queued.length === 0) return []
  const next = Math.min(...queued.map(r => signingGroup(r.meaning)))
  return queued.filter(r => signingGroup(r.meaning) === next)
}
