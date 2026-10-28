// Pure-logic tests for the per-document aggregation inside the PM dashboard.
// The HTTP + Prisma layer is skipped here; the integration path is covered
// implicitly by the shared evaluateStageTransition tests.
//
// This file pins the two bits of logic that aren't in evaluateStageTransition:
//   - overdue flag (targetCompletionDate < now AND status != 'signed')
//   - bottleneck tally (pending rows grouped by userId)

import { describe, expect, it } from 'vitest'
import { evaluateStageTransition, type RaciRowForEval } from '../document-raci/transition-engine.js'

interface DocLike {
  id: string
  status: string
  targetCompletionDate: Date | null
}

function isOverdue(d: DocLike, now: Date): boolean {
  return d.targetCompletionDate !== null && d.targetCompletionDate < now && d.status !== 'signed'
}

function tallyBottlenecks(rows: Array<Pick<RaciRowForEval, 'letter' | 'submittedAt' | 'reviewedAt' | 'approvedAt' | 'rejectedAt' | 'removedAt'> & { userId: string }>): Array<{ userId: string; pendingCount: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.removedAt !== null) continue
    if (r.rejectedAt !== null) continue
    const pending =
      (r.letter === 'R' && r.submittedAt === null) ||
      (r.letter === 'C' && r.reviewedAt === null) ||
      (r.letter === 'A' && r.approvedAt === null)
    if (!pending) continue
    counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([userId, pendingCount]) => ({ userId, pendingCount }))
    .sort((a, b) => b.pendingCount - a.pendingCount)
}

describe('PM dashboard — overdue flag', () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
  const now = new Date()

  it('flags doc with targetCompletionDate in the past + not signed', () => {
    expect(isOverdue({ id: 'd', status: 'in_review', targetCompletionDate: yesterday }, now)).toBe(true)
  })

  it('does NOT flag doc that is signed (even if past deadline)', () => {
    expect(isOverdue({ id: 'd', status: 'signed', targetCompletionDate: yesterday }, now)).toBe(false)
  })

  it('does NOT flag doc with a future deadline', () => {
    expect(isOverdue({ id: 'd', status: 'in_review', targetCompletionDate: tomorrow }, now)).toBe(false)
  })

  it('does NOT flag doc without a deadline', () => {
    expect(isOverdue({ id: 'd', status: 'in_review', targetCompletionDate: null }, now)).toBe(false)
  })
})

describe('PM dashboard — bottleneck tally', () => {
  function row(overrides: Partial<RaciRowForEval & { userId: string }>) {
    return {
      userId: 'u-x',
      letter: 'R' as const,
      submittedAt: null,
      reviewedAt: null,
      approvedAt: null,
      rejectedAt: null,
      removedAt: null,
      ...overrides,
    }
  }

  it('counts a user with multiple pending rows across the project', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-approver', letter: 'A' }),
      row({ userId: 'u-approver', letter: 'A' }),
      row({ userId: 'u-approver', letter: 'A' }),
      row({ userId: 'u-writer',   letter: 'R' }),
    ])
    expect(result).toEqual([
      { userId: 'u-approver', pendingCount: 3 },
      { userId: 'u-writer',   pendingCount: 1 },
    ])
  })

  it('excludes completed rows', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-approver', letter: 'A', approvedAt: new Date() }),
      row({ userId: 'u-approver', letter: 'A' }),
    ])
    expect(result).toEqual([{ userId: 'u-approver', pendingCount: 1 }])
  })

  it('excludes removed rows', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-x', letter: 'C', removedAt: new Date() }),
      row({ userId: 'u-x', letter: 'C' }),
    ])
    expect(result).toEqual([{ userId: 'u-x', pendingCount: 1 }])
  })

  it('excludes rejected rows', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-x', letter: 'A', rejectedAt: new Date() }),
      row({ userId: 'u-x', letter: 'A' }),
    ])
    expect(result).toEqual([{ userId: 'u-x', pendingCount: 1 }])
  })

  it('I rows are never pending (informed = no action required)', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-x', letter: 'I' }),
    ])
    expect(result).toEqual([])
  })

  it('sorts by pendingCount descending', () => {
    const result = tallyBottlenecks([
      row({ userId: 'u-small', letter: 'R' }),
      row({ userId: 'u-big',   letter: 'A' }),
      row({ userId: 'u-big',   letter: 'A' }),
      row({ userId: 'u-mid',   letter: 'C' }),
      row({ userId: 'u-mid',   letter: 'C' }),
      row({ userId: 'u-mid',   letter: 'C' }),
    ])
    expect(result.map(r => r.userId)).toEqual(['u-mid', 'u-big', 'u-small'])
  })
})

describe('PM dashboard — evaluateStageTransition integration smoke', () => {
  // Just checks the engine still returns the shape the dashboard reads.
  it('returns gatingLetter + cohort counts for a doc with 3 R rows', () => {
    const now = new Date()
    const rows: RaciRowForEval[] = [
      { letter: 'R', signatureRequired: false, submittedAt: now,  reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      { letter: 'R', signatureRequired: false, submittedAt: now,  reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
      { letter: 'R', signatureRequired: false, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null },
    ]
    const r = evaluateStageTransition('in_authoring', rows)
    expect(r.gatingLetter).toBe('R')
    expect(r.cohortDone).toBe(2)
    expect(r.cohortTotal).toBe(3)
    expect(r.cohortComplete).toBe(false)
  })
})
