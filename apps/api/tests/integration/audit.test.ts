// Integration tests for the Postgres audit trail — proves the hash chain
// holds under real inserts, that chain verification catches tampering, and
// that the DB-level BEFORE UPDATE/DELETE triggers refuse mutation attempts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgresAuditRepository } from '../../src/audit/postgres-repository.js'
import type { AuditEventShape } from '../../src/audit/hash.js'
import { startPostgres, type TestDb } from './setup-postgres.js'

const AUDIT_SECRET = 'test-secret-32chars-long-xxxxxxxx'

function sampleEvent(seq: number): AuditEventShape {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    actorId: `user-${seq}`,
    action: 'project.create',
    entityType: 'project',
    entityId: `proj-${seq}`,
    details: { seq, note: 'test' },
    ipAddress: '127.0.0.1',
  }
}

describe('PostgresAuditRepository', () => {
  let db: TestDb
  let repo: PostgresAuditRepository

  beforeAll(async () => {
    db = await startPostgres()
    repo = new PostgresAuditRepository(db.prisma, AUDIT_SECRET)
  }, 90_000)

  afterAll(async () => {
    await db?.stop()
  })

  it('appends events with a continuous hash chain', async () => {
    const r1 = await repo.append(sampleEvent(1))
    const r2 = await repo.append(sampleEvent(2))
    const r3 = await repo.append(sampleEvent(3))

    expect(r1.id).toBeDefined()
    expect(r2.id).not.toBe(r1.id)
    expect(r3.rowHash).toHaveLength(64)

    const chain = await repo.verifyChain()
    expect(chain.intact).toBe(true)
    expect(chain.firstBreakAt).toBeNull()
  })

  it('lists events for an entity in chronological order', async () => {
    const entityId = `entity-${Date.now()}`
    await repo.append({ ...sampleEvent(10), entityId, action: 'a1' })
    await repo.append({ ...sampleEvent(11), entityId, action: 'a2' })
    await repo.append({ ...sampleEvent(12), entityId, action: 'a3' })

    const rows = await repo.listForEntity('project', entityId)
    expect(rows.map(r => r.action)).toEqual(['a1', 'a2', 'a3'])
    expect(rows[0]!.prevHash === '' || rows[0]!.prevHash.length === 64).toBe(true)
  })

  it('refuses UPDATE at the DB level (immutability trigger)', async () => {
    await repo.append(sampleEvent(20))
    await expect(
      db.prisma.$executeRawUnsafe("UPDATE audit_events SET action = 'tampered' WHERE id = (SELECT MAX(id) FROM audit_events)"),
    ).rejects.toThrow(/append-only|insufficient_privilege/i)
  })

  it('refuses DELETE at the DB level (immutability trigger)', async () => {
    await repo.append(sampleEvent(21))
    await expect(
      db.prisma.$executeRawUnsafe('DELETE FROM audit_events WHERE id = (SELECT MAX(id) FROM audit_events)'),
    ).rejects.toThrow(/append-only|insufficient_privilege/i)
  })

  it('detects a chain break if row_hash is forged post-hoc', async () => {
    // Use a dedicated DB so the forged row doesn't poison the shared chain.
    const other = await startPostgres()
    try {
      const forgedRepo = new PostgresAuditRepository(other.prisma, AUDIT_SECRET)
      await forgedRepo.append(sampleEvent(30))
      await forgedRepo.append(sampleEvent(31))

      // Simulate an attacker with raw DB access: disable the triggers, forge a
      // row_hash, re-enable. The hash chain must detect the forgery regardless
      // of whether the triggers were bypassed.
      await other.prisma.$executeRawUnsafe('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update')
      await other.prisma.$executeRawUnsafe(
        "UPDATE audit_events SET row_hash = repeat('f', 64) WHERE id = (SELECT MIN(id) FROM audit_events)",
      )
      await other.prisma.$executeRawUnsafe('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update')

      const chain = await forgedRepo.verifyChain()
      expect(chain.intact).toBe(false)
      expect(chain.firstBreakAt).not.toBeNull()
    } finally {
      await other.stop()
    }
  }, 120_000)
})
