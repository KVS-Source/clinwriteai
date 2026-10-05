// Postgres-backed AuditRepository — the production implementation.
// Per ADR 0002: writes bypass Prisma's query builder for audit_events and go
// through raw SQL so the hash chain stays authoritative.
//
// Concurrency: hash chains are inherently serial. We use a transaction-scoped
// advisory lock (pg_advisory_xact_lock) so concurrent writers queue in Postgres
// rather than racing to compute prev_hash. The lock key is a hash of the
// literal 'audit_events' — same key on every connection in the cluster.

import type { PrismaClient } from '@prisma/client'
import type { AuditEventShape } from './hash.js'
import type { AuditRepository } from './repository.js'
import { computeRowHash, findChainBreak } from './hash.js'

// Deterministic 32-bit int derived from CRC32-like fold of 'audit_events'.
// Must stay constant across deploys — rotating this key breaks the ordering
// guarantee between in-flight transactions written against the old vs new key.
const AUDIT_ADVISORY_LOCK_KEY = 7_438_912_041n % 2_147_483_647n  // fits int4

interface AuditRow {
  id: string
  timestamp: Date
  actor_id: string
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  ip_address: string | null
  prev_hash: string
  row_hash: string
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditSecret: string,
  ) {}

  async append(event: AuditEventShape): Promise<{ id: string; rowHash: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent audit writes so prev_hash reads are consistent.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_KEY})`)

      const lastRows = await tx.$queryRawUnsafe<Array<{ row_hash: string }>>(
        'SELECT row_hash FROM audit_events ORDER BY id DESC LIMIT 1',
      )
      const prevHash = lastRows[0]?.row_hash ?? ''

      const rowHash = computeRowHash(prevHash, event, this.auditSecret)

      const inserted = await tx.$queryRawUnsafe<Array<{ id: bigint }>>(
        `INSERT INTO audit_events
           (actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash, "timestamp")
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         RETURNING id`,
        event.actorId,
        event.action,
        event.entityType,
        event.entityId,
        JSON.stringify(event.details),
        event.ipAddress,
        prevHash,
        rowHash,
        new Date(event.timestamp),
      )

      const id = inserted[0]?.id
      if (id === undefined) throw new Error('audit_events INSERT returned no id')
      return { id: String(id), rowHash }
    })
  }

  async listForEntity(
    entityType: string,
    entityId: string,
    limit = 100,
  ): Promise<ReadonlyArray<AuditEventShape & { id: string; prevHash: string; rowHash: string }>> {
    const rows = await this.prisma.$queryRawUnsafe<AuditRow[]>(
      `SELECT id, "timestamp", actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash
       FROM audit_events
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY id ASC
       LIMIT $3`,
      entityType,
      entityId,
      limit,
    )
    return rows.map(toShape)
  }

  async verifyChain(fromId?: string, toId?: string): Promise<{ intact: boolean; firstBreakAt: string | null }> {
    const rows = await this.prisma.$queryRawUnsafe<AuditRow[]>(
      `SELECT id, "timestamp", actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash
       FROM audit_events
       WHERE ($1::bigint IS NULL OR id >= $1::bigint)
         AND ($2::bigint IS NULL OR id <= $2::bigint)
       ORDER BY id ASC`,
      fromId ?? null,
      toId ?? null,
    )

    // When starting from the middle of the chain, seed with the actual stored
    // prev_hash of the first row; genesis-anchor only applies at id=1.
    const genesisPrev = rows[0]?.prev_hash ?? ''
    const breakIdx = findChainBreak(rows.map(toShape), this.auditSecret, genesisPrev)
    if (breakIdx === -1) return { intact: true, firstBreakAt: null }
    return { intact: false, firstBreakAt: String(rows[breakIdx]!.id) }
  }
}

function toShape(row: AuditRow): AuditEventShape & { id: string; prevHash: string; rowHash: string } {
  return {
    id: String(row.id),
    timestamp: row.timestamp.toISOString(),
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    ipAddress: row.ip_address,
    prevHash: row.prev_hash,
    rowHash: row.row_hash,
  }
}
