// Pure logic for the section-lock lease math + stale-steal transaction.
// Prisma is faked at the method surface so these tests stay in-memory.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, SectionLock } from '@prisma/client'
import {
  acquireLock,
  getHolder,
  isLive,
  listDocumentLocks,
  releaseLock,
  requireLockHeldBy,
  SECTION_LOCK_STALE_SECONDS,
} from './service.js'

type Row = SectionLock
const now = () => new Date('2026-10-27T10:00:00Z')
const minsAgo = (n: number) => new Date(now().getTime() - n * 60_000)

function fakeDb(seed: Row[] = []) {
  const rows: Row[] = [...seed]
  const key = (r: { documentId: string; sectionId: string }) => `${r.documentId}::${r.sectionId}`

  const impl = {
    sectionLock: {
      findUnique: vi.fn(async ({ where }: { where: { documentId_sectionId?: { documentId: string; sectionId: string } } }) => {
        if (!where.documentId_sectionId) return null
        return rows.find(r => key(r) === key(where.documentId_sectionId!)) ?? null
      }),
      findMany: vi.fn(async ({ where, orderBy }: { where: { documentId: string; lastHeartbeatAt?: { gte: Date } }; orderBy?: { lastHeartbeatAt: 'desc' | 'asc' } }) => {
        let out = rows.filter(r => r.documentId === where.documentId)
        if (where.lastHeartbeatAt?.gte) {
          const cutoff = where.lastHeartbeatAt.gte
          out = out.filter(r => r.lastHeartbeatAt >= cutoff)
        }
        if (orderBy?.lastHeartbeatAt === 'desc') out = [...out].sort((a, b) => b.lastHeartbeatAt.getTime() - a.lastHeartbeatAt.getTime())
        return out
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find(r => r.id === where.id)!
        Object.assign(r, data)
        return r
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex(r => r.id === where.id)
        if (i < 0) throw new Error('row not found')
        return rows.splice(i, 1)[0]!
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> & { id?: string } }) => {
        const row: Row = { id: data.id ?? `lock-${rows.length + 1}`, ...data }
        rows.push(row)
        return row
      }),
    },
    $transaction: async <T>(fn: (tx: typeof impl) => Promise<T>): Promise<T> => fn(impl),
  }
  return { prisma: impl as unknown as PrismaClient, rows }
}

const base = { documentId: 'DOC-1', sectionId: 'sec-a' }

beforeEach(() => { vi.setSystemTime(now()) })

describe('isLive', () => {
  it('true when heartbeat is within the stale window', () => {
    const row = { lastHeartbeatAt: new Date(now().getTime() - 30_000) } as Row
    expect(isLive(row, now())).toBe(true)
  })
  it('false when heartbeat is past the stale window', () => {
    const row = { lastHeartbeatAt: new Date(now().getTime() - (SECTION_LOCK_STALE_SECONDS + 1) * 1000) } as Row
    expect(isLive(row, now())).toBe(false)
  })
})

describe('acquireLock', () => {
  it("outcome 'acquired' when nothing exists", async () => {
    const { prisma, rows } = fakeDb()
    const res = await acquireLock(prisma, { ...base, userId: 'u1' })
    expect(res.outcome).toBe('acquired')
    expect(res.holder.userId).toBe('u1')
    expect(res.holder.expiresInSeconds).toBe(SECTION_LOCK_STALE_SECONDS)
    expect(rows).toHaveLength(1)
  })

  it("outcome 'extended' when the same user re-acquires a live lock", async () => {
    const { prisma } = fakeDb([{
      id: 'L1', ...base, userId: 'u1',
      acquiredAt: minsAgo(1), lastHeartbeatAt: minsAgo(1),
    }])
    const res = await acquireLock(prisma, { ...base, userId: 'u1' })
    expect(res.outcome).toBe('extended')
    expect(res.holder.lastHeartbeatAt.getTime()).toBe(now().getTime())
  })

  it("outcome 'conflict' when a different user holds a live lock", async () => {
    const { prisma, rows } = fakeDb([{
      id: 'L1', ...base, userId: 'u1',
      acquiredAt: minsAgo(0.5), lastHeartbeatAt: minsAgo(0.5),
    }])
    const res = await acquireLock(prisma, { ...base, userId: 'u2' })
    expect(res.outcome).toBe('conflict')
    expect(res.holder.userId).toBe('u1')
    expect(rows).toHaveLength(1)
  })

  it("outcome 'stolen' when the existing lock is stale", async () => {
    const { prisma, rows } = fakeDb([{
      id: 'L-stale', ...base, userId: 'u1',
      acquiredAt: minsAgo(10), lastHeartbeatAt: minsAgo(10),
    }])
    const res = await acquireLock(prisma, { ...base, userId: 'u2' })
    expect(res.outcome).toBe('stolen')
    expect(res.holder.userId).toBe('u2')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe('L-stale')  // old row deleted, new row inserted
  })

  it("same user can reclaim their own stale lock → outcome 'stolen'", async () => {
    // After a browser crash the writer's own lock lingers until stale, then they
    // come back and acquire fresh. We treat this as 'stolen' (new row) rather
    // than 'extended' because the lease identity changes.
    const { prisma } = fakeDb([{
      id: 'L-stale', ...base, userId: 'u1',
      acquiredAt: minsAgo(10), lastHeartbeatAt: minsAgo(10),
    }])
    const res = await acquireLock(prisma, { ...base, userId: 'u1' })
    expect(res.outcome).toBe('stolen')
    expect(res.holder.userId).toBe('u1')
  })
})

describe('releaseLock', () => {
  it('deletes when the caller holds the lock', async () => {
    const { prisma, rows } = fakeDb([{
      id: 'L1', ...base, userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now(),
    }])
    expect(await releaseLock(prisma, { ...base, userId: 'u1' })).toBe(true)
    expect(rows).toHaveLength(0)
  })

  it('no-op (returns false) when a different user tries to release without force', async () => {
    const { prisma, rows } = fakeDb([{
      id: 'L1', ...base, userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now(),
    }])
    expect(await releaseLock(prisma, { ...base, userId: 'u2' })).toBe(false)
    expect(rows).toHaveLength(1)
  })

  it('deletes when force=true (admin override)', async () => {
    const { prisma, rows } = fakeDb([{
      id: 'L1', ...base, userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now(),
    }])
    expect(await releaseLock(prisma, { ...base, userId: 'admin-1', force: true })).toBe(true)
    expect(rows).toHaveLength(0)
  })

  it('returns false when no lock exists', async () => {
    const { prisma } = fakeDb()
    expect(await releaseLock(prisma, { ...base, userId: 'u1' })).toBe(false)
  })
})

describe('getHolder + requireLockHeldBy + listDocumentLocks', () => {
  it('getHolder treats stale rows as absent', async () => {
    const { prisma } = fakeDb([{
      id: 'L1', ...base, userId: 'u1',
      acquiredAt: minsAgo(10), lastHeartbeatAt: minsAgo(10),
    }])
    expect(await getHolder(prisma, base)).toBeNull()
  })

  it('requireLockHeldBy returns null when caller holds the live lock', async () => {
    const { prisma } = fakeDb([{
      id: 'L1', ...base, userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now(),
    }])
    expect(await requireLockHeldBy(prisma, { ...base, userId: 'u1' })).toBeNull()
  })

  it('requireLockHeldBy returns the foreign holder when caller is blocked', async () => {
    const { prisma } = fakeDb([{
      id: 'L1', ...base, userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now(),
    }])
    const h = await requireLockHeldBy(prisma, { ...base, userId: 'u2' })
    expect(h?.userId).toBe('u1')
  })

  it('requireLockHeldBy returns null when the foreign lock is stale (treated as absent)', async () => {
    const { prisma } = fakeDb([{
      id: 'L1', ...base, userId: 'u1',
      acquiredAt: minsAgo(10), lastHeartbeatAt: minsAgo(10),
    }])
    expect(await requireLockHeldBy(prisma, { ...base, userId: 'u2' })).toBeNull()
  })

  it('listDocumentLocks returns one entry per live lock on the document', async () => {
    const { prisma } = fakeDb([
      { id: 'L1', documentId: 'DOC-1', sectionId: 'sec-a', userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now() },
      { id: 'L2', documentId: 'DOC-1', sectionId: 'sec-b', userId: 'u2', acquiredAt: now(), lastHeartbeatAt: now() },
      { id: 'L3', documentId: 'DOC-1', sectionId: 'sec-c', userId: 'u3', acquiredAt: minsAgo(10), lastHeartbeatAt: minsAgo(10) },  // stale
      { id: 'L4', documentId: 'DOC-OTHER', sectionId: 'sec-a', userId: 'u1', acquiredAt: now(), lastHeartbeatAt: now() },           // wrong doc
    ])
    const out = await listDocumentLocks(prisma, 'DOC-1')
    expect(out.map(x => x.sectionId).sort()).toEqual(['sec-a', 'sec-b'])
  })
})
