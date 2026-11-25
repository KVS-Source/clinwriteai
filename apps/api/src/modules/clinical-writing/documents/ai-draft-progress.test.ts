import { describe, expect, it } from 'vitest'
import { draftProgress } from './ai-draft-progress.js'

describe('draftProgress', () => {
  it('counts the sections the drafter has written into, out of every section of the document', () => {
    expect(draftProgress([{ aiSpanCount: 1 }, { aiSpanCount: 1 }, { aiSpanCount: 0 }, { aiSpanCount: 0 }])).toEqual({ draftedSections: 2, totalSections: 4 })
  })
  it('is 0 of N before anything has been written, and N of N once every section is', () => {
    expect(draftProgress([{ aiSpanCount: 0 }, { aiSpanCount: 0 }])).toEqual({ draftedSections: 0, totalSections: 2 })
    expect(draftProgress([{ aiSpanCount: 1 }, { aiSpanCount: 2 }])).toEqual({ draftedSections: 2, totalSections: 2 })
  })
  it('treats a missing count as not drafted, and a document with no sections as 0 of 0', () => {
    expect(draftProgress([{ aiSpanCount: null }])).toEqual({ draftedSections: 0, totalSections: 1 })
    expect(draftProgress([])).toEqual({ draftedSections: 0, totalSections: 0 })
  })
})
