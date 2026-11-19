// Scoring rubric + loop-exit tests for the template format-extraction
// phase + the new merge helper that writes refined rules back into
// DocumentTemplate.sections[] (migration 94 — SectionTemplate folded in).

import { describe, expect, it } from 'vitest'
import {
  scoreFormatRules,
  shouldStopFormatLoop,
  __test__,
} from '../../../../../worker/src/jobs/distill-template.js'

const {
  parseFormatRulesResponse,
  mergeFormatRulesIntoSections,
  FORMAT_CONFIDENCE_TARGET,
  FORMAT_MIN_ITERATIONS,
  FORMAT_MAX_ITERATIONS,
} = __test__

describe('scoreFormatRules — penalises missing axes + short bodies', () => {
  it('awards 100 when the ruleset covers font + paragraph + structure + has length', () => {
    const rules = [
      'Font: Times New Roman 11pt, black.',
      'Paragraphs: justified alignment, 1.15 line-height, 6pt space after.',
      'Lists: numbered, one item per line.',
      'Tables: 0.5pt solid black borders.',
    ].join('\n')
    const { score, flags } = scoreFormatRules(rules)
    expect(score).toBe(100)
    expect(flags).toEqual([])
  })

  it('flags too_short on < 40 chars', () => {
    const { score, flags } = scoreFormatRules('Font: Arial.')
    expect(flags).toContain('format:too_short')
    expect(score).toBeLessThan(FORMAT_CONFIDENCE_TARGET)
  })

  it('bottoms the score at 0 when every axis fires', () => {
    const { score, flags } = scoreFormatRules('x')
    expect(flags.length).toBeGreaterThanOrEqual(3)
    expect(score).toBe(0)
  })
})

describe('shouldStopFormatLoop — mirrors the 85% rubric', () => {
  it('always stops at MAX_ITERATIONS', () => {
    expect(shouldStopFormatLoop(FORMAT_MAX_ITERATIONS, new Map([['s1', 40]]))).toBe(true)
  })

  it('never stops before MIN_ITERATIONS even when all clear target', () => {
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS - 1, new Map([['s1', 100]]))).toBe(false)
  })

  it('stops at MIN_ITERATIONS when every section clears', () => {
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS, new Map([['s1', 95], ['s2', 90]]))).toBe(true)
  })

  it('keeps iterating past MIN_ITERATIONS when any section is below target', () => {
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS, new Map([['s1', 90], ['s2', 50]]))).toBe(false)
  })
})

describe('parseFormatRulesResponse — tolerant to Claude variations', () => {
  it('accepts a bare { id: "<rules>" } object', () => {
    expect(parseFormatRulesResponse('{"s6_2": "Font: Arial 11pt."}')).toEqual({ ok: { s6_2: 'Font: Arial 11pt.' } })
  })

  it('accepts the { rules: {...} } wrapper', () => {
    expect(parseFormatRulesResponse('{"rules": {"s6_2": "x"}}')).toEqual({ ok: { s6_2: 'x' } })
  })

  it('strips a ```json fence if present', () => {
    expect(parseFormatRulesResponse('```json\n{"s6_2": "x"}\n```')).toEqual({ ok: { s6_2: 'x' } })
  })

  it('returns a typed failure for malformed JSON', () => {
    const r = parseFormatRulesResponse('not json')
    expect('fail' in r).toBe(true)
  })
})

describe('mergeFormatRulesIntoSections — writes rules back into template.sections[]', () => {
  const baseSections = [
    { id: 's1',   number: '1',   title: 'Introduction' },
    { id: 's6_2', number: '6.2', title: 'Inclusion Criteria' },
    { id: 's7_4', number: '7.4', title: 'Statistical Analysis' },
  ]

  it('adds formatRules to sections that have extracted rules', () => {
    const { sections, merged } = mergeFormatRulesIntoSections(baseSections, {
      s1:   'Font: Arial.',
      s6_2: 'Lists: numbered, one criterion per line.',
    })
    expect(merged).toBe(2)
    expect(sections[0]).toMatchObject({ id: 's1',   formatRules: 'Font: Arial.' })
    expect(sections[1]).toMatchObject({ id: 's6_2', formatRules: 'Lists: numbered, one criterion per line.' })
    // s7_4 was not in the rules map — must not gain a formatRules key.
    expect(sections[2]).not.toHaveProperty('formatRules')
  })

  it('leaves sections untouched when the rules value is empty / whitespace', () => {
    const { sections, merged } = mergeFormatRulesIntoSections(baseSections, {
      s1: '   \n  ',
    })
    expect(merged).toBe(0)
    expect(sections[0]).not.toHaveProperty('formatRules')
  })

  it('does not mutate the input section objects', () => {
    const before = JSON.parse(JSON.stringify(baseSections))
    mergeFormatRulesIntoSections(baseSections, { s1: 'Font: Arial.' })
    expect(baseSections).toEqual(before)
  })
})
