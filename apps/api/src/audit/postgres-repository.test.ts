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

describe('PostgresAuditRepository.pageForEntity', () => {
  it('asks for newest first, with the page window and action filter, and returns the true total', async () => {
    const sqls: Array<{ sql: string; args: unknown[] }> = []
    const $queryRawUnsafe = vi.fn(async (sql: string, ...args: unknown[]) => {
      sqls.push({ sql, args })
      return /COUNT\(\*\)/.test(sql) ? [{ n: 231n }] : []
    })
    const repo = new PostgresAuditRepository({ $queryRawUnsafe } as unknown as PrismaClient, SECRET)

    const page = await repo.pageForEntity('document', 'DOC-1', { limit: 100, offset: 200, action: 'qa_review_logged' })

    expect(page).toEqual({ rows: [], total: 231 })
    const rowsQuery = sqls.find(q => /ORDER BY id DESC/.test(q.sql))!
    expect(rowsQuery.args).toEqual(['document', 'DOC-1', 'qa_review_logged', null, null, 100, 200])
    const countQuery = sqls.find(q => /COUNT\(\*\)/.test(q.sql))!
    expect(countQuery.args).toEqual(['document', 'DOC-1', 'qa_review_logged', null, null])
  })

  it('applies the date range to both the page and the count', async () => {
    const sqls: Array<{ sql: string; args: unknown[] }> = []
    const $queryRawUnsafe = vi.fn(async (sql: string, ...args: unknown[]) => {
      sqls.push({ sql, args })
      return /COUNT\(\*\)/.test(sql) ? [{ n: 12n }] : []
    })
    const repo = new PostgresAuditRepository({ $queryRawUnsafe } as unknown as PrismaClient, SECRET)
    const from = '2026-09-27T18:30:00.000Z'
    const to = '2026-10-28T18:29:59.999Z'

    const page = await repo.pageForEntity('document', 'DOC-1', { limit: 100, from, to })

    expect(page.total).toBe(12)
    for (const q of sqls) {
      expect(q.sql).toContain('"timestamp" >= $4::timestamptz')
      expect(q.sql).toContain('"timestamp" <= $5::timestamptz')
      expect(q.args.slice(0, 5)).toEqual(['document', 'DOC-1', null, from, to])
    }
  })

  it('passes null when no action filter is given', async () => {
    const $queryRawUnsafe = vi.fn(async (sql: string) => (/COUNT\(\*\)/.test(sql) ? [{ n: 0n }] : []))
    const repo = new PostgresAuditRepository({ $queryRawUnsafe } as unknown as PrismaClient, SECRET)
    await repo.pageForEntity('document', 'DOC-1')
    const rowsCall = $queryRawUnsafe.mock.calls.find(c => /ORDER BY id DESC/.test(String(c[0])))!
    expect(rowsCall.slice(1)).toEqual(['document', 'DOC-1', null, null, null, 100, 0])
  })
})

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

  // Known exceptions (#1953, #1963) are listed only when they fall inside the
  // range that was checked.
  describe('known exceptions in the response', () => {
    const ids = (r: { exceptions: ReadonlyArray<{ id: string }> }) => r.exceptions.map(e => e.id)

    it('lists none for a range that does not contain them', async () => {
      const { prisma } = fakePrisma(buildChain(2_100))
      const repo = new PostgresAuditRepository(prisma, SECRET)
      expect(ids(await repo.verifyChain('1', '100'))).toEqual([])
      expect(ids(await repo.verifyChain('1500', '1900'))).toEqual([])
    })

    it('lists both for a range that contains both, and for the whole chain', async () => {
      const { prisma } = fakePrisma(buildChain(2_100))
      const repo = new PostgresAuditRepository(prisma, SECRET)
      expect(ids(await repo.verifyChain('1500', '2000'))).toEqual(['1953', '1963'])
      expect(ids(await repo.verifyChain())).toEqual(['1953', '1963'])
    })

    it('lists only the one inside a range that contains just one', async () => {
      const { prisma } = fakePrisma(buildChain(2_100))
      const repo = new PostgresAuditRepository(prisma, SECRET)
      expect(ids(await repo.verifyChain('1900', '1960'))).toEqual(['1953'])
    })

    it('still gives each exception a plain-language summary', async () => {
      const { prisma } = fakePrisma(buildChain(2_100))
      const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain('1950', '1970')
      for (const e of result.exceptions as ReadonlyArray<{ summary: string; reason: string }>) {
        expect(e.summary.length).toBeGreaterThan(20)
        expect(e.summary).not.toMatch(/fromId|NULL|undefined|canonical/i)
        expect(e.reason).toMatch(/seal/i)  // the technical text is still there
      }
    })

    it('skips a known-exception row without flagging it, but still flags a real break next to it', async () => {
      const rows = buildChain(2_100)
      rows[1952]!.details = { seq: 'sealed differently' }   // id 1953, a known exception
      rows[1999]!.details = { seq: 'tampered' }              // id 2000, not an exception
      const { prisma } = fakePrisma(rows)
      const result = await new PostgresAuditRepository(prisma, SECRET).verifyChain('1900', '2050')
      expect(result).toMatchObject({ intact: false, firstBreakAt: '2000', unexpectedBreaks: ['2000'] })
    })
  })
})
