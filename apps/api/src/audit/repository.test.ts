import { describe, expect, it } from 'vitest'
import { InMemoryAuditRepository } from './repository.js'
import type { AuditEventShape } from './hash.js'

const SECRET = 'test-audit-secret-32-bytes-long-for-vitest'

const makeEvent = (seq: number): AuditEventShape => ({
  timestamp: new Date(2026, 9, 5, 12, seq).toISOString(),
  actorId: `user-${seq}`,
  action: 'test.action',
  entityType: 'test',
  entityId: String(seq),
  details: { seq },
  ipAddress: null,
})

describe('InMemoryAuditRepository', () => {
  it('appends events and chains hashes correctly', async () => {
    const repo = new InMemoryAuditRepository(SECRET)
    const r1 = await repo.append(makeEvent(1))
    const r2 = await repo.append(makeEvent(2))
    const r3 = await repo.append(makeEvent(3))

    expect(r1.id).toBe('1')
    expect(r2.id).toBe('2')
    expect(r3.id).toBe('3')

    const verify = await repo.verifyChain()
    expect(verify.intact).toBe(true)
    expect(verify.firstBreakAt).toBe(null)
  })

  it('verifies an empty chain', async () => {
    const repo = new InMemoryAuditRepository(SECRET)
    const verify = await repo.verifyChain()
    expect(verify.intact).toBe(true)
  })

  it('filters listForEntity by entityType + entityId', async () => {
    const repo = new InMemoryAuditRepository(SECRET)
    await repo.append({ ...makeEvent(1), entityType: 'document', entityId: 'DOC-001' })
    await repo.append({ ...makeEvent(2), entityType: 'document', entityId: 'DOC-002' })
    await repo.append({ ...makeEvent(3), entityType: 'document', entityId: 'DOC-001' })
    await repo.append({ ...makeEvent(4), entityType: 'project',  entityId: 'DOC-001' })

    const forDoc1 = await repo.listForEntity('document', 'DOC-001')
    expect(forDoc1).toHaveLength(2)
    expect(forDoc1.map(e => e.actorId)).toEqual(['user-1', 'user-3'])
  })

  it('pageForEntity returns newest first with the true total, honouring offset and action', async () => {
    const repo = new InMemoryAuditRepository(SECRET)
    for (let i = 1; i <= 10; i++) {
      await repo.append({ ...makeEvent(i), action: i % 4 === 0 ? 'review' : 'read', entityType: 'doc', entityId: 'X' })
    }
    await repo.append({ ...makeEvent(99), entityType: 'doc', entityId: 'OTHER' })

    const first = await repo.pageForEntity('doc', 'X', { limit: 3 })
    expect(first.total).toBe(10)
    expect(first.rows.map(e => e.actorId)).toEqual(['user-10', 'user-9', 'user-8'])

    const second = await repo.pageForEntity('doc', 'X', { limit: 3, offset: 3 })
    expect(second.rows.map(e => e.actorId)).toEqual(['user-7', 'user-6', 'user-5'])

    const lastReview = await repo.pageForEntity('doc', 'X', { limit: 1, action: 'review' })
    expect(lastReview.total).toBe(2)
    expect(lastReview.rows.map(e => e.actorId)).toEqual(['user-8'])

    expect((await repo.pageForEntity('doc', 'X', { offset: 50 })).rows).toEqual([])
    expect(await repo.pageForEntity('doc', 'NONE')).toEqual({ rows: [], total: 0 })
  })

  it('respects the limit on listForEntity', async () => {
    const repo = new InMemoryAuditRepository(SECRET)
    for (let i = 1; i <= 10; i++) {
      await repo.append({ ...makeEvent(i), entityType: 'doc', entityId: 'X' })
    }
    const last3 = await repo.listForEntity('doc', 'X', 3)
    expect(last3).toHaveLength(3)
    expect(last3.map(e => e.actorId)).toEqual(['user-8', 'user-9', 'user-10'])
  })
})
