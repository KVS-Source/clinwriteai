import { describe, expect, it } from 'vitest'
import { computeRowHash, findChainBreak, type AuditEventShape } from './hash.js'

const SECRET = 'test-audit-secret-32-bytes-long-for-vitest'

const sampleEvent = (overrides: Partial<AuditEventShape> = {}): AuditEventShape => ({
  timestamp: '2026-10-05T12:00:00.000Z',
  actorId: 'user-mw',
  action: 'document.updated',
  entityType: 'document',
  entityId: 'DOC-001',
  details: { field: 'status', from: 'draft', to: 'in-authoring' },
  ipAddress: '203.0.113.42',
  ...overrides,
})

describe('computeRowHash', () => {
  it('is deterministic for the same input', () => {
    const event = sampleEvent()
    const h1 = computeRowHash('', event, SECRET)
    const h2 = computeRowHash('', event, SECRET)
    expect(h1).toBe(h2)
  })

  it('produces a 64-char hex sha256 digest', () => {
    const event = sampleEvent()
    const hash = computeRowHash('', event, SECRET)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('depends on prev_hash', () => {
    const event = sampleEvent()
    const h1 = computeRowHash('', event, SECRET)
    const h2 = computeRowHash('previous-hash-value', event, SECRET)
    expect(h1).not.toBe(h2)
  })

  it('depends on the audit secret', () => {
    const event = sampleEvent()
    const h1 = computeRowHash('', event, 'secret-a')
    const h2 = computeRowHash('', event, 'secret-b')
    expect(h1).not.toBe(h2)
  })

  it('is insensitive to key order in details', () => {
    const h1 = computeRowHash('', sampleEvent({ details: { a: 1, b: 2 } }), SECRET)
    const h2 = computeRowHash('', sampleEvent({ details: { b: 2, a: 1 } }), SECRET)
    expect(h1).toBe(h2)
  })

  it('detects any change to any field', () => {
    const original = sampleEvent()
    const originalHash = computeRowHash('', original, SECRET)

    const tweaks: Array<Partial<AuditEventShape>> = [
      { actorId: 'different' },
      { action: 'document.deleted' },
      { entityType: 'other' },
      { entityId: 'DOC-002' },
      { details: { field: 'status', from: 'draft', to: 'in-review' } },
      { ipAddress: '10.0.0.1' },
      { timestamp: '2026-10-05T12:00:01.000Z' },
    ]

    for (const tweak of tweaks) {
      const tweaked = computeRowHash('', sampleEvent(tweak), SECRET)
      expect(tweaked).not.toBe(originalHash)
    }
  })
})

describe('findChainBreak', () => {
  it('returns -1 for an intact chain', () => {
    const e1 = sampleEvent({ action: 'a' })
    const e2 = sampleEvent({ action: 'b' })
    const e3 = sampleEvent({ action: 'c' })

    const h1 = computeRowHash('', e1, SECRET)
    const h2 = computeRowHash(h1, e2, SECRET)
    const h3 = computeRowHash(h2, e3, SECRET)

    const chain = [
      { ...e1, prevHash: '',  rowHash: h1 },
      { ...e2, prevHash: h1, rowHash: h2 },
      { ...e3, prevHash: h2, rowHash: h3 },
    ]
    expect(findChainBreak(chain, SECRET)).toBe(-1)
  })

  it('detects a tampered row', () => {
    const e1 = sampleEvent({ action: 'a' })
    const e2 = sampleEvent({ action: 'b' })
    const e3 = sampleEvent({ action: 'c' })

    const h1 = computeRowHash('', e1, SECRET)
    const h2 = computeRowHash(h1, e2, SECRET)
    const h3 = computeRowHash(h2, e3, SECRET)

    const chain = [
      { ...e1, prevHash: '',  rowHash: h1 },
      // Someone changed row 2's action after it was written but didn't recompute the hash
      { ...e2, action: 'tampered', prevHash: h1, rowHash: h2 },
      { ...e3, prevHash: h2, rowHash: h3 },
    ]
    expect(findChainBreak(chain, SECRET)).toBe(1)
  })

  it('detects a reordered row', () => {
    const e1 = sampleEvent({ action: 'a' })
    const e2 = sampleEvent({ action: 'b' })

    const h1 = computeRowHash('', e1, SECRET)
    const h2 = computeRowHash(h1, e2, SECRET)

    // Reordered: e2 appears first but its prev_hash still points at e1
    const chain = [
      { ...e2, prevHash: h1, rowHash: h2 },
      { ...e1, prevHash: '',  rowHash: h1 },
    ]
    expect(findChainBreak(chain, SECRET)).toBe(0)
  })
})
