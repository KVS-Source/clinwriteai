// PostgresAuditRepository.verifyChain walks the chain in batches. These
// tests drive it with a fake $queryRawUnsafe that honours the from/to/after
// id parameters + LIMIT, over a chain long enough to span several batches.

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { computeRowHash, type AuditEventShape } from './hash.js'
import { PostgresAuditRepository } from './postgres-repository.js'

const SECRET = 'test-audit-secret-32-bytes-long-for-vitest'

interface StoredRow {
  id: bigint
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

function buildChain(length: number): StoredRow[] {
  const rows: StoredRow[] = []
  let prev = ''
  for (let i = 1; i <= length; i++) {
    const event: AuditEventShape = {
      timestamp: new Date(Date.UTC(2026, 9, 12, 0, 0, 0, i)).toISOString(),
      actorId: `user-${i % 7}`,
      action: 'test.action',
      entityType: 'test',
      entityId: String(i),
      details: { seq: i },
      ipAddress: null,
    }
    const rowHash = computeRowHash(prev, event, SECRET)
    rows.push({
      id: BigInt(i),
      timestamp: new Date(event.timestamp),
      actor_id: event.actorId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      details: event.details,
      ip_address: null,
      prev_hash: prev,
      row_hash: rowHash,
    })
    prev = rowHash
  }
  return rows
}

function fakePrisma(rows: StoredRow[]) {
  const $queryRawUnsafe = vi.fn(async (sql: string, fromId: string | null, toId: string | null, afterId: string | null) => {
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? rows.length)
    return rows
      .filter(r => (fromId === null || r.id >= BigInt(fromId))
                && (toId === null || r.id <= BigInt(toId))
                && (afterId === null || r.id > BigInt(afterId)))
      .slice(0, limit)
  })
  return { prisma: { $queryRawUnsafe } as unknown as PrismaClient, $queryRawUnsafe }
}

describe('PostgresAuditRepository.verifyChain (batched)', () => {
  // All assertions use toMatchObject on { intact, firstBreakAt } because
  // the full VerifyChainResult now also includes `unexpectedBreaks` and
  // `exceptions`; the test's only interest is the intact/firstBreakAt
  // decision.
  it('verifies a chain spanning several batches', async () => {
    const { prisma, $queryRawUnsafe } = fakePrisma(buildChain(12_001))
    const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain()
    expect(result).toMatchObject({ intact: true, firstBreakAt: null })
    expect($queryRawUnsafe.mock.calls.length).toBeGreaterThan(2)
  })

  it('verifies an exact multiple of the batch size and an empty table', async () => {
    const exact = fakePrisma(buildChain(10_000))
    expect(await new PostgresAuditRepository(exact.prisma, SECRET).verifyChain()).toMatchObject({ intact: true, firstBreakAt: null })

    const empty = fakePrisma([])
    expect(await new PostgresAuditRepository(empty.prisma, SECRET).verifyChain()).toMatchObject({ intact: true, firstBreakAt: null })
  })

  it('finds a tampered row in a later batch', async () => {
    const rows = buildChain(12_001)
    rows[7_499]!.details = { seq: 'tampered' }   // id 7500
    const { prisma } = fakePrisma(rows)
    const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain()
    expect(result).toMatchObject({ intact: false, firstBreakAt: '7500' })
  })

  it('catches a broken link exactly at a batch boundary', async () => {
    const rows = buildChain(6_000)
    rows[5_000]!.prev_hash = 'forged'             // id 5001, first row of batch 2
    const { prisma } = fakePrisma(rows)
    const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain()
    expect(result).toMatchObject({ intact: false, firstBreakAt: '5001' })
  })

  it('verifies a mid-chain range seeded from its first stored prev_hash', async () => {
    const { prisma } = fakePrisma(buildChain(8_000))
    const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain('3000', '7000')
    expect(result).toMatchObject({ intact: true, firstBreakAt: null })
  })
})
