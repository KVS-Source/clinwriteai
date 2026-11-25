// Tests for the Module 5 read-only gate (Package R-4).

import { describe, expect, it } from 'vitest'
import { checkModule5Gate } from './ectd-gate.js'

function stubPrisma(nodes: Array<{ moduleSection: string; isReadOnly: boolean }>) {
  return {
    ectdGranularityNode: {
      findMany: async () => nodes,
    },
  }
}

describe('checkModule5Gate', () => {
  it('flags read-only Module 5 nodes', async () => {
    const prisma = stubPrisma([
      { moduleSection: '5.3.5.1', isReadOnly: true },
      { moduleSection: '5.3.5.2', isReadOnly: true },
    ])
    const v = await checkModule5Gate(prisma as never, 'doc-1')
    expect(v.readOnly).toBe(true)
    expect(v.moduleSections).toEqual(['5.3.5.1', '5.3.5.2'])
    expect(v.message).toMatch(/Module 5/i)
  })

  it('allows non-Module-5 writable nodes', async () => {
    const prisma = stubPrisma([
      { moduleSection: '2.5', isReadOnly: false },
      { moduleSection: '2.7.4', isReadOnly: false },
    ])
    const v = await checkModule5Gate(prisma as never, 'doc-1')
    expect(v.readOnly).toBe(false)
    expect(v.moduleSections).toEqual([])
  })

  it('does not gate Module 5 nodes that are explicitly writable (edge case)', async () => {
    const prisma = stubPrisma([
      { moduleSection: '5.3.7', isReadOnly: false },   // CRF appendix might be writable in some flows
    ])
    const v = await checkModule5Gate(prisma as never, 'doc-1')
    expect(v.readOnly).toBe(false)
  })

  it('allows documents with no mapped node (safe-default)', async () => {
    const prisma = stubPrisma([])
    const v = await checkModule5Gate(prisma as never, 'doc-1')
    expect(v.readOnly).toBe(false)
  })

  it('soft-fails on DB error', async () => {
    const prisma = {
      ectdGranularityNode: { findMany: async () => { throw new Error('db down') } },
    }
    const v = await checkModule5Gate(prisma as never, 'doc-1')
    expect(v.readOnly).toBe(false)
  })
})
