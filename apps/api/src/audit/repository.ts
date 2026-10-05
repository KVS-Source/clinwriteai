// Audit event repository — the ONLY path for writing to audit_events.
// Per ADR 0002: audit_events uses a raw-SQL migration; writes go through this
// repository, not Prisma. A lint rule blocks `prisma.auditEvent.create(...)`
// from feature code (added Phase 1 Week 3).
//
// This is scaffold — the real implementation ships Phase 1 Week 4 against the
// actual Postgres connection from Prisma. The shape + interface are stable.

import type { AuditEventShape } from './hash.js'
import { computeRowHash, plainShape } from './hash.js'

export interface AuditRepository {
  /** Append a new audit event. Computes prev_hash + row_hash atomically. */
  append(event: AuditEventShape): Promise<{ id: string; rowHash: string }>

  /** Fetch recent events for an entity (read-only). */
  listForEntity(entityType: string, entityId: string, limit?: number): Promise<ReadonlyArray<AuditEventShape & { id: string; prevHash: string; rowHash: string }>>

  /** Verify the hash chain for a slice of the table. */
  verifyChain(fromId?: string, toId?: string): Promise<{ intact: boolean; firstBreakAt: string | null }>
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

  async verifyChain() {
    let expectedPrev = ''
    for (const row of this.rows) {
      if (row.prevHash !== expectedPrev) return { intact: false, firstBreakAt: row.id }
      const expectedRowHash = computeRowHash(expectedPrev, plainShape(row), this.auditSecret)
      if (row.rowHash !== expectedRowHash) return { intact: false, firstBreakAt: row.id }
      expectedPrev = row.rowHash
    }
    return { intact: true, firstBreakAt: null }
  }
}

// PostgresAuditRepository lives in ./postgres-repository.ts so this file stays
// Prisma-free and safe to import from pure unit tests.
