import { describe, expect, it } from 'vitest'
import { assignReviewOrder, isSequentialReview, reviewersAhead, reviewersWhoseTurnItIs, type ReviewOrderRow } from './review-order.js'

const c = (userId: string, approvalOrder: number | null, reviewedAt: string | null = null, over: Partial<ReviewOrderRow> = {}): ReviewOrderRow =>
  ({ userId, letter: 'C', approvalOrder, reviewedAt, removedAt: null, ...over })

describe('sequential review order', () => {
  it('parallel: everyone can act at once', () => {
    const rows = [c('a', null), c('b', null)]
    expect(isSequentialReview(rows)).toBe(false)
    expect(reviewersAhead(rows, 'b')).toEqual([])
    expect(reviewersWhoseTurnItIs(rows).sort()).toEqual(['a', 'b'])
  })

  it('sequential: only the front of the line can act, and the next one after they finish', () => {
    const rows = [c('a', 1), c('b', 2), c('d', 3)]
    expect(isSequentialReview(rows)).toBe(true)
    expect(reviewersAhead(rows, 'a')).toEqual([])
    expect(reviewersAhead(rows, 'b')).toEqual(['a'])
    expect(reviewersAhead(rows, 'd').sort()).toEqual(['a', 'b'])
    expect(reviewersWhoseTurnItIs(rows)).toEqual(['a'])

    const afterA = [c('a', 1, '2026-11-12'), c('b', 2), c('d', 3)]
    expect(reviewersAhead(afterA, 'b')).toEqual([])
    expect(reviewersWhoseTurnItIs(afterA)).toEqual(['b'])
    expect(reviewersWhoseTurnItIs([c('a', 1, 'x'), c('b', 2, 'x'), c('d', 3, 'x')])).toEqual([])
  })

  it('reviewers sharing a place go together; someone with section rows uses their earliest place', () => {
    const rows = [c('a', 1), c('b', 1), c('d', 2), c('d', 3)]
    expect(reviewersWhoseTurnItIs(rows).sort()).toEqual(['a', 'b'])
    expect(reviewersAhead(rows, 'd').sort()).toEqual(['a', 'b'])
    expect(reviewersAhead([c('a', 1, 'x'), c('b', 1), c('d', 2)], 'd')).toEqual(['b'])
  })

  it('ignores removed reviewers, other letters, and people who are not reviewers', () => {
    const rows: ReviewOrderRow[] = [c('a', 1, null, { removedAt: '2026-11-11' }), c('b', 2), { userId: 'q', letter: 'Q', approvalOrder: 1, reviewedAt: null, removedAt: null }]
    expect(reviewersAhead(rows, 'b')).toEqual([])               // a was removed: b is first
    expect(reviewersAhead(rows, 'q')).toEqual([])               // QC is never in the line
    expect(reviewersAhead(rows, 'nobody')).toEqual([])
    expect(reviewersWhoseTurnItIs(rows)).toEqual(['b'])
  })
})

describe('assignReviewOrder', () => {
  it('sequential: the panel order first, reviewers it did not name after, one place each', () => {
    const m = assignReviewOrder({ reviewType: 'sequential', reviewerIds: ['a', 'b', 'd', 'a'], payloadOrder: ['d', 'x', 'a'] })
    expect([...m.entries()]).toEqual([['d', 1], ['a', 2], ['b', 3]])
  })
  it('parallel (or unknown): no places', () => {
    for (const reviewType of ['parallel', null, undefined] as const) {
      expect([...assignReviewOrder({ reviewType, reviewerIds: ['a', 'b'], payloadOrder: ['b', 'a'] }).values()]).toEqual([null, null])
    }
  })
})
