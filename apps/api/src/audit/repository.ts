// Audit event repository — the ONLY path for writing to audit_events.
// Per ADR 0002: audit_events uses a raw-SQL migration; writes go through this
// repository, not Prisma. A lint rule blocks `prisma.auditEvent.create(...)`
// from feature code (added Phase 1 Week 3).
//
// This is scaffold — the real implementation ships Phase 1 Week 4 against the
// actual Postgres connection from Prisma. The shape + interface are stable.

import type { AuditEventShape } from './hash.js'
import { computeRowHash, plainShape } from './hash.js'
import {
  AUDIT_CHAIN_KNOWN_EXCEPTIONS,
  isKnownAuditException,
  type AuditChainException,
} from './known-exceptions.js'

export interface VerifyChainResult {
  /** True when every break (if any) is a documented known exception. */
  intact:        boolean
  /** First id whose row_hash or prev_hash didn't verify. null when intact. */
  firstBreakAt:  string | null
  /** All real (unexpected) break ids in the verified range. */
  unexpectedBreaks: ReadonlyArray<string>
  /**
   * Known-bad entries encountered in the range. Always surfaced so the
   * Compliance UI + auditors can see which rows were skipped and why —
   * never hidden.
   */
  exceptions:    ReadonlyArray<AuditChainException>
}

export type StoredAuditEvent = AuditEventShape & { id: string; prevHash: string; rowHash: string }

export interface EntityPageOptions {
  limit?:  number
  offset?: number
  action?: string
}

export interface EntityPage {
  /** Newest first. */
  rows:  ReadonlyArray<StoredAuditEvent>
  /** Every matching event, not just this page. */
  total: number
}

export interface AuditRepository {
  /** Append a new audit event. Computes prev_hash + row_hash atomically. */
  append(event: AuditEventShape): Promise<{ id: string; rowHash: string }>

  /** Fetch recent events for an entity (read-only). */
  listForEntity(entityType: string, entityId: string, limit?: number): Promise<ReadonlyArray<AuditEventShape & { id: string; prevHash: string; rowHash: string }>>

  /**
   * One page of an entity's events, NEWEST first, with the true total.
   * `action` narrows to a single action (e.g. the latest 'qa_review_logged'
   * is `{ limit: 1, action }`).
   */
  pageForEntity(entityType: string, entityId: string, opts?: EntityPageOptions): Promise<EntityPage>

  /** Verify the hash chain for a slice of the table. */
  verifyChain(fromId?: string, toId?: string): Promise<VerifyChainResult>
}

/**
 * In-memory implementation used ONLY in Phase 1 unit tests before the real
 * Postgres-backed implementation lands. Keeps the test suite independent of
 * Testcontainers for pure-logic tests of the hash chain.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private readonly rows: Array<AuditEventShape & { id: string; prevHash: string; rowHash: string }> = []
  private nextId = 1

  constructor(private readonly auditSecret: string) {}

  async append(event: AuditEventShape): Promise<{ id: string; rowHash: string }> {
    const prevHash = this.rows.length === 0 ? '' : this.rows[this.rows.length - 1]!.rowHash
    const rowHash = computeRowHash(prevHash, event, this.auditSecret)
    const id = String(this.nextId++)
    this.rows.push({ ...event, id, prevHash, rowHash })
    return { id, rowHash }
  }

  async listForEntity(entityType: string, entityId: string, limit = 100) {
    return this.rows
      .filter(r => r.entityType === entityType && r.entityId === entityId)
      .slice(-limit)
  }

  async pageForEntity(entityType: string, entityId: string, opts: EntityPageOptions = {}): Promise<EntityPage> {
    const { limit = 100, offset = 0, action } = opts
    const matching = this.rows
      .filter(r => r.entityType === entityType && r.entityId === entityId && (!action || r.action === action))
      .reverse()
    return { rows: matching.slice(offset, offset + limit), total: matching.length }
  }

  async verifyChain(): Promise<VerifyChainResult> {
    const unexpected: string[] = []
    let expectedPrev = ''
    for (const row of this.rows) {
      const prevMismatch = row.prevHash !== expectedPrev
      const expectedRowHash = computeRowHash(expectedPrev, plainShape(row), this.auditSecret)
      const hashMismatch = row.rowHash !== expectedRowHash
      if (prevMismatch || hashMismatch) {
        if (!isKnownAuditException(row.id)) unexpected.push(row.id)
        // Carry the ACTUAL stored row_hash forward either way so a single
        // bad row doesn't cascade into every row after it being flagged
        // too (otherwise known-exception rows would mask real breaks).
      }
      expectedPrev = row.rowHash
    }
    return {
      intact: unexpected.length === 0,
      firstBreakAt: unexpected[0] ?? null,
      unexpectedBreaks: unexpected,
      exceptions: AUDIT_CHAIN_KNOWN_EXCEPTIONS,
    }
  }
}

// PostgresAuditRepository lives in ./postgres-repository.ts so this file stays
// Prisma-free and safe to import from pure unit tests.
