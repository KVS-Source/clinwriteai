// CW-096: the AI first draft marks what the sources lack as [TBD: ...] instead of writing an explanation
// paragraph. The markers must be read back correctly (worker) and caught by the placeholder check, the
// ICH E3 progress and the signature gate (API) — otherwise they would be signed as if finished.

import { describe, expect, it } from 'vitest'
import { extractMissingItems } from '../../../../../worker/src/jobs/missing-items.js'
import { sectionPlaceholderCount } from '../ich-e3/catalog.js'
import { checkSignableContent } from '../signatures/content-gate.js'
import { evaluateContentNoPlaceholders } from '../checklist/autocheck/content-strategies.js'

describe('extractMissingItems', () => {
  it('lists the text of each [TBD: ...] marker once, ignoring tags and case', () => {
    const html = '<p>Study title: [TBD: study title from the protocol]</p><ul><li>Indication [tbd : indication]</li><li>Again [TBD: indication]</li></ul><p>[TBD]</p>'
    expect(extractMissingItems(html)).toEqual(['study title from the protocol', 'indication', 'unspecified'])
  })
  it('finds nothing in finished text, and caps a long list', () => {
    expect(extractMissingItems('<p>Reported in [1] and Table 14.2.1</p>')).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `[TBD: item ${i}]`).join(' ')
    expect(extractMissingItems(many)).toHaveLength(12)
  })
})

describe('a [TBD: ...] marker is caught before signature', () => {
  it('counts as a placeholder in the ICH E3 progress', () => {
    expect(sectionPlaceholderCount('<p>Title [TBD: study title] and sponsor [TBD]</p>')).toBe(2)
    expect(sectionPlaceholderCount('<p>Dose [TBC - from protocol]</p>')).toBe(1)
  })
  it('keeps the "no placeholders" checklist strategy pending', () => {
    const r = evaluateContentNoPlaceholders([], [{ sectionId: 's1', sectionNumber: '§1', contentHtml: '<p>[TBD: study title]</p>' }])
    expect(r.kind).toBe('pending')
  })
  it('holds the signature gate shut', () => {
    const r = checkSignableContent({
      documentType: 'protocol',
      sections: [{ sectionId: 'p1', sectionNumber: '1', sectionTitle: 'Title Page', contentHtml: '<p>Study title: [TBD: study title from the protocol]</p>' }],
    })
    expect(r.problems).toEqual([{ section: '1 Title Page', reason: 'placeholders', placeholders: 1 }])
  })
})
