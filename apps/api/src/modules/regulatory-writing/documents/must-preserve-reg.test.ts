// Tests for the Regulatory attached-context builder (Package R-4).

import { describe, expect, it } from 'vitest'
import { buildRegulatoryAttachedContext, __test__ } from './must-preserve-reg.js'

function stubPrisma(entries: Array<{ content: unknown; sourceType?: string; version?: string }>) {
  return {
    regulatoryDocument: {
      findUnique: async () => ({ submissionId: 'sub-1' }),
    },
    canonicalJsonEntry: {
      findMany: async () => entries.map(e => ({ sourceType: e.sourceType ?? 'csr', version: e.version ?? 'v1', ...e })),
    },
  }
}

describe('walkContent — structural identifier extraction', () => {
  it('extracts Table + Section + Figure + Study tokens from strings', () => {
    const tokens = new Set<string>()
    const surnames = new Set<string>()
    __test__.walkContent('Refer to Table 14.2.1 and §4.1. See also Figure 2.1 and Study CDP-102.', tokens, surnames)
    expect([...tokens]).toEqual(expect.arrayContaining(['Table 14.2.1', '§4.1', 'Figure 2.1', 'Study CDP-102']))
  })

  it('recurses into arrays + nested objects', () => {
    const tokens = new Set<string>()
    const surnames = new Set<string>()
    __test__.walkContent({
      meta: { title: 'See Table 1.1' },
      rows: [{ ref: '§5.3.2.1' }, { ref: 'Table 14.2.7a' }],
    }, tokens, surnames)
    expect([...tokens]).toEqual(expect.arrayContaining(['Table 1.1', '§5.3.2.1', 'Table 14.2.7a']))
  })

  it('tolerates null / undefined / numeric input', () => {
    const tokens = new Set<string>()
    const surnames = new Set<string>()
    __test__.walkContent(null, tokens, surnames)
    __test__.walkContent(undefined, tokens, surnames)
    __test__.walkContent(42, tokens, surnames)
    expect(tokens.size).toBe(0)
    expect(surnames.size).toBe(0)
  })
})

describe('buildRegulatoryAttachedContext', () => {
  it('returns a dedup allow-list of Table / Section / Figure / Study tokens from the submission index', async () => {
    const prisma = stubPrisma([
      { content: { title: 'CSR 102', refs: ['Table 14.2.1', 'Table 14.2.1', '§14.2.3.1'] } },
      { content: { tlfIndex: [{ ref: 'Table 14.3.1' }, { ref: 'Figure 2.1' }] } },
      { content: 'See Study NCT12345678 for details.' },
    ])
    const ctx = await buildRegulatoryAttachedContext(prisma as never, 'reg-doc-1')
    expect(ctx.allowedTokens).toEqual(expect.arrayContaining(['Table 14.2.1', '§14.2.3.1', 'Table 14.3.1', 'Figure 2.1', 'Study NCT12345678']))
    // Dedup — 'Table 14.2.1' appears twice in input, once in output.
    expect(ctx.allowedTokens.filter(t => t === 'Table 14.2.1')).toHaveLength(1)
  })

  it('returns an empty context when the submission has no indexed entries (degraded mode)', async () => {
    const prisma = stubPrisma([])
    const ctx = await buildRegulatoryAttachedContext(prisma as never, 'reg-doc-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })

  it('lifts author surnames out of indexed narrative', async () => {
    const prisma = stubPrisma([
      { content: 'Discussion mentions Smith et al. and Patel 2024.' },
    ])
    const ctx = await buildRegulatoryAttachedContext(prisma as never, 'reg-doc-1')
    expect(ctx.authorSurnames).toEqual(expect.arrayContaining(['Smith', 'Patel']))
  })

  it('soft-fails on DB error', async () => {
    const prisma = {
      regulatoryDocument: { findUnique: async () => { throw new Error('db down') } },
      canonicalJsonEntry: { findMany: async () => [] },
    }
    const ctx = await buildRegulatoryAttachedContext(prisma as never, 'reg-doc-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })
})
