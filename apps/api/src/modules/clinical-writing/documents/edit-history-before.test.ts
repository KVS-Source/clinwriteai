import { describe, expect, it } from 'vitest'
import { enrichWithDerivedBefore } from './edit-history-before.js'

describe('enrichWithDerivedBefore', () => {
  it('fills first row with empty string', () => {
    const out = enrichWithDerivedBefore([
      { beforeHtml: null, afterHtml: '<p>A</p>' },
    ])
    expect(out[0]!.effectiveBeforeHtml).toBe('')
  })

  it('derives from previous row when stored beforeHtml is null', () => {
    const out = enrichWithDerivedBefore([
      { beforeHtml: null, afterHtml: '<p>A</p>' },
      { beforeHtml: null, afterHtml: '<p>A plus edit</p>' },
      { beforeHtml: null, afterHtml: '<p>A plus edit plus more</p>' },
    ])
    expect(out[0]!.effectiveBeforeHtml).toBe('')
    expect(out[1]!.effectiveBeforeHtml).toBe('<p>A</p>')
    expect(out[2]!.effectiveBeforeHtml).toBe('<p>A plus edit</p>')
  })

  it('prefers the stored beforeHtml when present (legacy rows)', () => {
    const out = enrichWithDerivedBefore([
      { beforeHtml: null,        afterHtml: '<p>A</p>' },
      { beforeHtml: '<p>LEG</p>', afterHtml: '<p>B</p>' },   // legacy stored before
      { beforeHtml: null,        afterHtml: '<p>C</p>' },
    ])
    expect(out[0]!.effectiveBeforeHtml).toBe('')
    expect(out[1]!.effectiveBeforeHtml).toBe('<p>LEG</p>')   // stored wins
    expect(out[2]!.effectiveBeforeHtml).toBe('<p>B</p>')     // derived from prev afterHtml
  })

  it('returns an empty array for empty input', () => {
    expect(enrichWithDerivedBefore([])).toEqual([])
  })
})
