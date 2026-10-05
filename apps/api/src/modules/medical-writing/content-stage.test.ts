import { describe, expect, it } from 'vitest'
import {
  complianceTrackIsLocked,
  nextContentStage,
  STAGE_LABELS,
  type ContentStage,
} from './content-stage.js'

describe('content stage machine', () => {
  it('advances linearly through all 6 stages', () => {
    const path: ContentStage[] = [1, 2, 3, 4, 5, 6]
    for (let i = 0; i < path.length - 1; i++) {
      expect(nextContentStage(path[i]!)).toBe(path[i + 1])
    }
  })

  it('stage 6 is terminal', () => {
    expect(nextContentStage(6)).toBeNull()
  })

  it('locks compliance_track from stage 2 onward (DD-C-001)', () => {
    expect(complianceTrackIsLocked(1)).toBe(false)
    expect(complianceTrackIsLocked(2)).toBe(true)
    expect(complianceTrackIsLocked(6)).toBe(true)
  })

  it('exposes human-readable labels for each stage', () => {
    expect(STAGE_LABELS[1]).toBe('briefing')
    expect(STAGE_LABELS[6]).toBe('approved')
  })
})
