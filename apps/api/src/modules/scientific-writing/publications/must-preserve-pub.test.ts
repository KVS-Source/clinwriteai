// Tests for the publication attached-context builder (Package B-3).
// No real Prisma — pass a hand-rolled stub so the citation-grounding
// context stays deterministic.

import { describe, expect, it } from 'vitest'
import { buildPublicationAttachedContext, __test__ } from './must-preserve-pub.js'

const { firstWord } = __test__

function stubPrisma(rows: Array<{ shortRef: string | null; removedAt?: Date | null }>) {
  return {
    citation: {
      findMany: async () => rows,
    },
  }
}

describe('firstWord — surname extraction from shortRef', () => {
  it('pulls the leading author surname from Vancouver-style shortRef', () => {
    expect(firstWord('Socinski M et al., JCO 2021')).toBe('Socinski')
    expect(firstWord('Smith JA et al., NEJM 2020;382:1-10')).toBe('Smith')
  })

  it('normalises casing', () => {
    expect(firstWord('smith JA et al., NEJM 2020')).toBe('Smith')
  })

  it('returns null on empty / null / numeric-leading input', () => {
    expect(firstWord(null)).toBeNull()
    expect(firstWord(undefined)).toBeNull()
    expect(firstWord('')).toBeNull()
    expect(firstWord('   ')).toBeNull()
    expect(firstWord('2021 Smith et al.')).toBeNull()
  })

  it('handles hyphenated and accented surnames', () => {
    expect(firstWord(`O'Brien MA et al., Lancet 2019`)).toBe(`O'Brien`)
    expect(firstWord('García-López R, BMJ 2022')).toBe('García-López')
  })
})

describe('buildPublicationAttachedContext', () => {
  it('builds allowedTokens [1]..[N] matching the number of non-removed citations', async () => {
    const prisma = stubPrisma([
      { shortRef: 'Socinski M et al., JCO 2021' },
      { shortRef: 'Smith J et al., NEJM 2020' },
      { shortRef: 'Jones K et al., Lancet 2019' },
    ])
    const ctx = await buildPublicationAttachedContext(prisma as never, 'pub-1')
    expect(ctx.allowedTokens).toEqual(['[1]', '[2]', '[3]'])
    expect(ctx.authorSurnames).toEqual(expect.arrayContaining(['Socinski', 'Smith', 'Jones']))
  })

  it('returns empty context when the publication has no citations', async () => {
    const prisma = stubPrisma([])
    const ctx = await buildPublicationAttachedContext(prisma as never, 'pub-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })

  it('deduplicates author surnames when the same author appears in multiple citations', async () => {
    const prisma = stubPrisma([
      { shortRef: 'Socinski M et al., JCO 2021' },
      { shortRef: 'Socinski M et al., JAMA 2023' },
    ])
    const ctx = await buildPublicationAttachedContext(prisma as never, 'pub-1')
    expect(ctx.allowedTokens).toEqual(['[1]', '[2]'])
    expect(ctx.authorSurnames).toEqual(['Socinski'])
  })

  it('falls back to empty context when prisma throws (soft failure)', async () => {
    const prisma = {
      citation: { findMany: async () => { throw new Error('db down') } },
    }
    const ctx = await buildPublicationAttachedContext(prisma as never, 'pub-1')
    expect(ctx.allowedTokens).toEqual([])
    expect(ctx.authorSurnames).toEqual([])
  })
})
