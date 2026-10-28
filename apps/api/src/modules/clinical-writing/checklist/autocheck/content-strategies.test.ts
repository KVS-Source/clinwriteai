import { describe, expect, it } from 'vitest'
import {
  evaluateContentMinWords,
  evaluateContentNoPlaceholders,
  evaluateReferencesComplete,
  parseAutoCompleteTag,
  type SectionContentForCheck,
} from './content-strategies.js'

const sections: SectionContentForCheck[] = [
  { sectionNumber: '10.1',   contentHtml: '<p>Subject disposition prose.</p>',                   wordCount: 80  },
  { sectionNumber: '11.4.1', contentHtml: '<p>Primary endpoint narrative with [TBD] still.</p>', wordCount: 350 },
  { sectionNumber: '14.1',   contentHtml: '<p>Reference tables listing.</p>',                    wordCount: 120 },
]

describe('parseAutoCompleteTag', () => {
  it('parses strategy with no args', () => {
    expect(parseAutoCompleteTag('content-no-placeholders')).toEqual({ strategy: 'content-no-placeholders', args: [] })
  })
  it('parses strategy with args', () => {
    expect(parseAutoCompleteTag('content-min-words:300:11.4.1')).toEqual({
      strategy: 'content-min-words', args: ['300', '11.4.1'],
    })
  })
  it('null / empty tag returns null', () => {
    expect(parseAutoCompleteTag(null)).toBeNull()
    expect(parseAutoCompleteTag('')).toBeNull()
    expect(parseAutoCompleteTag('   ')).toBeNull()
  })
  it('lowercases the strategy name', () => {
    expect(parseAutoCompleteTag('Content-Min-Words:50')?.strategy).toBe('content-min-words')
  })
})

describe('evaluateContentMinWords', () => {
  it('completes when section meets threshold', () => {
    const r = evaluateContentMinWords(['300', '11.4.1'], sections)
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.reason).toContain('350/300')
  })

  it('pending when section is under threshold', () => {
    const r = evaluateContentMinWords(['200', '10.1'], sections)
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('80/200')
  })

  it('counts across all sections when no section arg', () => {
    const r = evaluateContentMinWords(['400'], sections)
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.reason).toContain('550/400')
  })

  it('skips when the scoped section is missing', () => {
    const r = evaluateContentMinWords(['100', '99.9'], sections)
    expect(r.kind).toBe('skipped')
  })

  it('skips when threshold is not a positive number', () => {
    expect(evaluateContentMinWords([], sections).kind).toBe('skipped')
    expect(evaluateContentMinWords(['abc'], sections).kind).toBe('skipped')
    expect(evaluateContentMinWords(['-5'], sections).kind).toBe('skipped')
    expect(evaluateContentMinWords(['0'], sections).kind).toBe('skipped')
  })
})

describe('evaluateContentNoPlaceholders', () => {
  it('pending when any section has [TBD]', () => {
    const r = evaluateContentNoPlaceholders([], sections)
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') {
      expect(r.reason).toContain('[tbd]')
      expect(r.reason).toContain('11.4.1')
    }
  })

  it('pending when any section has [PLACEHOLDER]', () => {
    const r = evaluateContentNoPlaceholders([], [
      { sectionNumber: '12', contentHtml: 'Draft with [Placeholder] marker', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('[placeholder]')
  })

  it('pending when any section has [REF]', () => {
    const r = evaluateContentNoPlaceholders([], [
      { sectionNumber: '12', contentHtml: 'See [REF] for details', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('[ref]')
  })

  it('completed when all sections are clean', () => {
    const r = evaluateContentNoPlaceholders([], [
      { sectionNumber: '10', contentHtml: 'Clean prose with resolved citation', wordCount: 80 },
      { sectionNumber: '11', contentHtml: 'Another section without markers',   wordCount: 60 },
    ])
    expect(r.kind).toBe('completed')
  })

  it('scoped to one section ignores placeholders in others', () => {
    const r = evaluateContentNoPlaceholders(['10.1'], sections)
    expect(r.kind).toBe('completed')
  })

  it('skipped when scoped section is missing', () => {
    const r = evaluateContentNoPlaceholders(['99.9'], sections)
    expect(r.kind).toBe('skipped')
  })
})

describe('evaluateReferencesComplete', () => {
  it('pending when a section has [Ref: ...]', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '12', contentHtml: 'See [Ref: Smith 2020] for primary endpoint.', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') {
      expect(r.reason).toContain('[ref: …]')
      expect(r.reason).toContain('12')
    }
  })

  it('pending when a section has [cite]', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '12', contentHtml: 'Primary endpoint [cite] was met.', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('[cite …]')
  })

  it('pending when a section has [cite: xxx]', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '12', contentHtml: 'Mentioned in prior work [cite: Jones 2019].', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
  })

  it('pending when a section has [citation needed]', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '12', contentHtml: 'A notable finding [citation needed]', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('[citation needed]')
  })

  it('pending when a section has [reference needed]', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '12', contentHtml: 'Supporting data [Reference Needed] here.', wordCount: 50 },
    ])
    expect(r.kind).toBe('pending')
  })

  it('completed when sections are clean (no citation placeholders)', () => {
    const r = evaluateReferencesComplete([], [
      { sectionNumber: '10', contentHtml: 'Resolved citation (Smith, 2020) present.', wordCount: 80 },
      { sectionNumber: '11', contentHtml: 'Another citation (Jones et al., 2019).',   wordCount: 60 },
    ])
    expect(r.kind).toBe('completed')
  })

  it('completed on empty sections', () => {
    expect(evaluateReferencesComplete([], []).kind).toBe('completed')
  })

  it('scoped to one section ignores unresolved cites in others', () => {
    const r = evaluateReferencesComplete(['10'], [
      { sectionNumber: '10', contentHtml: 'Clean section (resolved).',  wordCount: 50 },
      { sectionNumber: '11', contentHtml: 'Section with [Ref: TBD].',   wordCount: 50 },
    ])
    expect(r.kind).toBe('completed')
  })

  it('skipped when scoped section is missing', () => {
    const r = evaluateReferencesComplete(['99.9'], [
      { sectionNumber: '10', contentHtml: 'Something', wordCount: 50 },
    ])
    expect(r.kind).toBe('skipped')
  })
})
