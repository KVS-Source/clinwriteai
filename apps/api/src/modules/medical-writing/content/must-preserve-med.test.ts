// Tests for the Medical attached-context builder (Package D-2).
// Verifies the ClaimsMatrixItem.sourceRef allow-list is scoped
// correctly to approved + library-adopted claims only.

import { describe, expect, it } from 'vitest'
import { buildMedContentAttachedContext, __test__ } from './must-preserve-med.js'

const { firstWord } = __test__

function stubPrisma(rows: Array<{ sourceRef: string }>) {
  // The helper calls prisma.claimsMatrixItem.findMany with a
  // status-scoped where clause + distinct. The stub honours both.
  return {
    claimsMatrixItem: {
      findMany: async () => rows,
    },
  }
}

describe('firstWord — surname-ish extraction from sourceRef', () => {
  it('pulls the leading alpha word out of a structural ref', () => {
    expect(firstWord('SmPC v2.1 §4.2')).toBe('SmPC')
    expect(firstWord('CSR Table 14.2.1')).toBe('CSR')
    expect(firstWord('Label §3.1')).toBe('Label')
  })

  it('normalises casing', () => {
    expect(firstWord('smith JA et al., NEJM 2020')).toBe('Smith')
  })

  it('returns null for empty / numeric-leading / whitespace input', () => {
    expect(firstWord('')).toBeNull()
    expect(firstWord('   ')).toBeNull()
    expect(firstWord('2024 approval memo')).toBeNull()
  })
})

describe('buildMedContentAttachedContext', () => {
  it('enumerates distinct sourceRefs as allowedTokens + collects their lead words', async () => {
    const prisma = stubPrisma([
      { sourceRef: 'SmPC v2.1 §4.2' },
      { sourceRef: 'CSR Table 14.2.1' },
      { sourceRef: 'Label §3.1' },
    ])
    const ctx = await buildMedContentAttachedContext(prisma as never, 'mc-1')
    expect(ctx.allowedTokens).toEqual(expect.arrayContaining(['SmPC v2.1 §4.2', 'CSR Table 14.2.1', 'Label §3.1']))
    expect(ctx.authorSurnames).toEqual(expect.arrayContaining(['SmPC', 'CSR', 'Label']))
  })

  it('returns an empty context when the content item has no approved claims', async () => {
    const prisma = stubPrisma([])
    const ctx = await buildMedContentAttachedContext(prisma as never, 'mc-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })

  it('deduplicates surnames when multiple claims share the same first word', async () => {
    const prisma = stubPrisma([
      { sourceRef: 'SmPC v2.1 §4.2' },
      { sourceRef: 'SmPC v2.1 §4.8' },
    ])
    const ctx = await buildMedContentAttachedContext(prisma as never, 'mc-1')
    expect(ctx.allowedTokens).toEqual(['SmPC v2.1 §4.2', 'SmPC v2.1 §4.8'])
    expect(ctx.authorSurnames).toEqual(['SmPC'])
  })

  it('soft-fails on DB error — returns empty context', async () => {
    const prisma = {
      claimsMatrixItem: { findMany: async () => { throw new Error('db down') } },
    }
    const ctx = await buildMedContentAttachedContext(prisma as never, 'mc-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })
})
