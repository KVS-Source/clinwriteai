import { describe, expect, it } from 'vitest'
import { nextSubmissionStage, redactionsLocked, STAGE_LABELS } from './submission-stage.js'

describe('submission stage machine', () => {
  it('advances linearly through all 6 stages', () => {
    for (let s = 1; s < 6; s++) {
      expect(nextSubmissionStage(s as 1 | 2 | 3 | 4 | 5)).toBe(s + 1)
    }
  })

  it('stage 6 is terminal', () => {
    expect(nextSubmissionStage(6)).toBeNull()
  })

  it('redactions lock from stage 5 onward (DD-D-003)', () => {
    expect(redactionsLocked(1)).toBe(false)
    expect(redactionsLocked(4)).toBe(false)
    expect(redactionsLocked(5)).toBe(true)
    expect(redactionsLocked(6)).toBe(true)
  })

  it('exposes stage labels for every number', () => {
    expect(STAGE_LABELS[1]).toBe('source_gathering')
    expect(STAGE_LABELS[6]).toBe('submitted')
  })
})
