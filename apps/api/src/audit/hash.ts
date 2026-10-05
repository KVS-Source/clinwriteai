// Audit-trail hash chain helpers.
// Per ADR 0001 (audit-hook as decisive factor) + ADR 0002 (audit_events table
// uses raw SQL migrations). Each audit_events row carries:
//   - prev_hash: the row_hash of the immediately preceding row (ORDER BY id)
//   - row_hash:  sha256(prev_hash || canonical_json(this_row_without_hashes) || audit_secret)
//
// The audit_secret is a 32-byte secret stored in sops-encrypted .env.enc and
// MUST never rotate (rotation breaks the chain). Lost-key recovery: restore
// from the sealed-hardcopy age key.

import { createHash } from 'node:crypto'

export interface AuditEventShape {
  timestamp: string          // ISO 8601 UTC
  actorId: string
  action: string
  entityType: string
  entityId: string
  details: Record<string, unknown>
  ipAddress: string | null
}

/**
 * Compute the row_hash for a new audit event.
 *
 * @param prevHash  The row_hash of the immediately-preceding audit event, or
 *                  the empty string for the genesis row.
 * @param event     The event being written (without hash fields).
 * @param auditSecret  32-byte secret from the SecretsProvider.
 */
export function computeRowHash(
  prevHash: string,
  event: AuditEventShape,
  auditSecret: string,
): string {
  // Canonical JSON — stable key order so re-hashing the same payload always
  // yields the same hash regardless of object insertion order.
  const canonical = canonicalJson(event)
  const hash = createHash('sha256')
  hash.update(prevHash, 'utf8')
  hash.update('|', 'utf8')
  hash.update(canonical, 'utf8')
  hash.update('|', 'utf8')
  hash.update(auditSecret, 'utf8')
  return hash.digest('hex')
}

/** Validate a chain segment — returns the index of the first break, or -1 if intact. */
export function findChainBreak(
  rows: Array<AuditEventShape & { prevHash: string; rowHash: string }>,
  auditSecret: string,
  genesisPrevHash: string = '',
): number {
  let expectedPrev = genesisPrevHash
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    if (row.prevHash !== expectedPrev) return i
    const expectedRowHash = computeRowHash(expectedPrev, plainShape(row), auditSecret)
    if (row.rowHash !== expectedRowHash) return i
    expectedPrev = row.rowHash
  }
  return -1
}

/** Strip the hash-chain fields so an enriched row can be re-hashed deterministically. */
export function plainShape(row: AuditEventShape): AuditEventShape {
  return {
    timestamp: row.timestamp,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    details: row.details,
    ipAddress: row.ipAddress,
  }
}

/** Stable JSON stringification with sorted keys at every level. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}
