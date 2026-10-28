import { describe, expect, it } from 'vitest'
import {
  evaluateContentMinWords,
  evaluateContentNoPlaceholders,
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
