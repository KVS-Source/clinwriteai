// Unit tests for the Jaccard similarity helpers.

import { describe, expect, it } from 'vitest'
import { bestLibraryMatch, jaccardSimilarity, tokenize } from './library-match.js'

describe('tokenize', () => {
  it('splits on non-alphanumerics, lowercases, drops one-letter tokens', () => {
    const tokens = tokenize('Veloricept + pembrolizumab (10 mg/kg) in NSCLC.')
    expect([...tokens].sort()).toEqual([
      '10', 'in', 'kg', 'mg', 'nsclc', 'pembrolizumab', 'veloricept',
    ])
  })

  it('returns an empty set for strings with no usable tokens', () => {
    expect(tokenize('').size).toBe(0)
    expect(tokenize('. , !  ').size).toBe(0)
  })
})

describe('jaccardSimilarity', () => {
  it('returns 100 for identical strings', () => {
    expect(jaccardSimilarity('PFS improved with pembrolizumab', 'PFS improved with pembrolizumab')).toBe(100)
  })

  it('returns 0 for completely disjoint strings', () => {
    expect(jaccardSimilarity('alpha beta gamma', 'delta epsilon zeta')).toBe(0)
  })

  it('computes intersection-over-union as a percentage', () => {
    // A = { pfs, improved, with, pembrolizumab }
    // B = { pfs, improved, with, veloricept }
    // intersection = 3, union = 5 → 60
    expect(jaccardSimilarity('PFS improved with pembrolizumab', 'PFS improved with veloricept')).toBe(60)
  })

  it('is case- and punctuation-insensitive', () => {
    expect(jaccardSimilarity('PFS Improved!', 'pfs, improved.')).toBe(100)
  })

  it('returns 0 for empty on either side', () => {
    expect(jaccardSimilarity('', 'anything')).toBe(0)
    expect(jaccardSimilarity('anything', '')).toBe(0)
  })
})

describe('bestLibraryMatch', () => {
  const pool = [
    { id: 'lib-1', title: 'Old wording',   body: 'Pembrolizumab improved PFS in NSCLC.' },
    { id: 'lib-2', title: 'Preferred',     body: 'Pembrolizumab + veloricept significantly improved PFS versus pembrolizumab alone.' },
    { id: 'lib-3', title: 'Off-topic',     body: 'Investor confidence remained steady in Q3.' },
  ]

  it('returns the top-scoring Library section', () => {
    const r = bestLibraryMatch('Pembrolizumab + veloricept significantly improved PFS', pool)
    expect(r.librarySectionId).toBe('lib-2')
    expect(r.similarityPct).toBeGreaterThanOrEqual(70)
    expect(r.libraryTitle).toBe('Preferred')
  })

  it('returns a null-shaped result when the pool is empty', () => {
    expect(bestLibraryMatch('anything', [])).toEqual({
      librarySectionId: null, libraryTitle: null, libraryBody: null, similarityPct: 0,
    })
  })

  it('returns a null-shaped result when nothing scores above 0', () => {
    const r = bestLibraryMatch('alpha beta', [{ id: 'x', title: 't', body: 'gamma delta' }])
    expect(r.librarySectionId).toBeNull()
    expect(r.similarityPct).toBe(0)
  })
})
