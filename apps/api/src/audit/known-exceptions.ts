// Audit-chain known-bad entries.
//
// Each entry here is a row in audit_events whose row_hash cannot be
// reproduced by the verifier — not because the row was tampered with, but
// because the SEALING code at the time of insert had a bug that is now
// fixed. The row itself stays in the DB, immutable, unmodified; the
// verifier is just taught not to raise an alarm for these specific ids.
//
// Adding an entry here MUST be paired with:
//   1. an incident doc under docs/compliance/ describing the bug, the fix
//      commit, and the operator who ran the trigger; and
//   2. a signed-off change ticket.
// A silent whitelist defeats the whole point of a Part 11 audit chain.
// The verifier surfaces every exception in its response so operators +
// auditors see them explicitly, never hidden.

export interface AuditChainException {
  /** audit_events.id (BIGSERIAL, string on the wire). */
  id:             string
  /** Human-readable explanation shown in the Compliance screen. */
  reason:         string
  /** Git commit that fixed the sealing bug so no new breaks occur. */
  fixedInCommit:  string
  /** Link to the incident writeup under docs/compliance/. */
  incidentDoc:    string
}

export const AUDIT_CHAIN_KNOWN_EXCEPTIONS: ReadonlyArray<AuditChainException> = [
  {
    id:            '1953',
    reason:        'audit_chain_verified sealed with fromId=undefined (as the literal string) ' +
                   'but Postgres stored the value as NULL — hash cannot be reproduced. Row ' +
                   'content itself is intact and inspectable.',
    fixedInCommit: '27e7ea5',
    incidentDoc:   'docs/compliance/audit-chain-incident-2026-10-21.md',
  },
  {
    id:            '1963',
    reason:        'Same sealing-vs-storage mismatch as #1953 — second audit_chain_verified ' +
                   "run against the same empty-range input before the sealing fix shipped.",
    fixedInCommit: '27e7ea5',
    incidentDoc:   'docs/compliance/audit-chain-incident-2026-10-21.md',
  },
]

const KNOWN_IDS = new Set(AUDIT_CHAIN_KNOWN_EXCEPTIONS.map(e => e.id))

export function isKnownAuditException(id: string): boolean {
  return KNOWN_IDS.has(id)
}

export function knownExceptionsInRange(fromId?: string, toId?: string): AuditChainException[] {
  const fromN = fromId ? Number(fromId) : -Infinity
  const toN   = toId   ? Number(toId)   : Infinity
  return AUDIT_CHAIN_KNOWN_EXCEPTIONS.filter(e => {
    const n = Number(e.id)
    return n >= fromN && n <= toN
  })
}
