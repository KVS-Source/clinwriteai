import { describe, expect, it } from 'vitest'
import { draftRollup } from './ai-draft-rollup.js'

const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 10, min))
const step = (kind: string, min: number, sectionId: string | null = null) => ({ kind, sectionId, timestamp: at(min) })

describe('draftRollup', () => {
  it('counts each section once when a restarted draft logs it again', () => {
    expect(draftRollup([
      step('job_started', 0), step('section_skipped', 1, 'title'), step('section_committed', 2, 's1'),
      step('job_started', 10), step('section_skipped', 11, 'title'), step('section_skipped', 11, 's1'), step('section_committed', 12, 's2'),
    ])).toMatchObject({ sectionsDrafted: 2, sectionsSkipped: 1, sectionsErrored: 0, runs: 2 })
  })
  it('counts a section drafted twice once, and one that failed and then succeeded as drafted', () => {
    expect(draftRollup([
      step('job_started', 0), step('section_errored', 1, 's1'), step('section_committed', 2, 's2'), step('section_committed', 3, 's2'),
      step('job_started', 4), step('section_committed', 5, 's1'), step('section_errored', 6, 's3'),
    ])).toMatchObject({ sectionsDrafted: 2, sectionsErrored: 1, sectionsSkipped: 0 })
  })
  it('measures from the first run to the last worker step, leaving out later auto-fill and rewrites', () => {
    const r = draftRollup([step('job_started', 0), step('job_started', 30), step('validation_pass_end', 41), step('tbd_autofill_run', 55), step('validator_check_result', 56)])
    expect(r.startedAt).toEqual(at(0))
    expect(r.elapsedMs).toBe(41 * 60_000)
  })
  it('is empty without steps', () => {
    expect(draftRollup([])).toEqual({ sectionsDrafted: 0, sectionsErrored: 0, sectionsSkipped: 0, runs: 0, startedAt: null, elapsedMs: null })
  })
})
