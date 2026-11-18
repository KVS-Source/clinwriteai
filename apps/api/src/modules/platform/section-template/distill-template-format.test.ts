// Scoring rubric + loop-exit tests for the template format-extraction
// worker (apps/worker/src/jobs/distill-template.ts, M-F.2). The worker
// package has no vitest config, so the pure functions get imported
// here — same pattern the policy-prompt parity test already uses.

import { describe, expect, it } from 'vitest'
import {
  scoreFormatRules,
  shouldStopFormatLoop,
  __test__,
} from '../../../../../worker/src/jobs/distill-template.js'

const { parseFormatRulesResponse, FORMAT_CONFIDENCE_TARGET, FORMAT_MIN_ITERATIONS, FORMAT_MAX_ITERATIONS } = __test__

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

  it('flags missing_font when no font / size / typeface mention', () => {
    const rules = 'Paragraphs justified, 1.15 line-height. Lists numbered. Tables with borders throughout.'
    const { flags } = scoreFormatRules(rules)
    expect(flags).toContain('format:missing_font')
  })

  it('flags missing_paragraph when no paragraph / line / align / indent mention', () => {
    const rules = 'Font: Times New Roman 11pt. Lists are numbered items. Tables have borders.'
    const { flags } = scoreFormatRules(rules)
    expect(flags).toContain('format:missing_paragraph')
  })

  it('flags missing_structure_hint when no list / table / heading mention', () => {
    const rules = 'Font: Arial 10pt. Paragraphs are justified with 1.2 line-height and 4pt indent before the first line.'
    const { flags } = scoreFormatRules(rules)
    expect(flags).toContain('format:missing_structure_hint')
  })

  it('bottoms the score at 0 when every axis fires', () => {
    const { score, flags } = scoreFormatRules('x')
    expect(flags.length).toBeGreaterThanOrEqual(3)
    expect(score).toBe(0)
  })
})

describe('shouldStopFormatLoop — mirrors the 85% confidence rubric', () => {
  it('always stops at MAX_ITERATIONS even if sections are still weak', () => {
    const scores = new Map([['s1', 40], ['s2', 50]])
    expect(shouldStopFormatLoop(FORMAT_MAX_ITERATIONS, scores)).toBe(true)
  })

  it('never stops before MIN_ITERATIONS even when all sections already clear the target', () => {
    const scores = new Map([['s1', 100], ['s2', 100]])
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS - 1, scores)).toBe(false)
  })

  it('stops at MIN_ITERATIONS when every section clears the target', () => {
    const scores = new Map([['s1', 95], ['s2', 90]])
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS, scores)).toBe(true)
  })

  it('keeps iterating past MIN_ITERATIONS when any section is below target', () => {
    const scores = new Map([['s1', 90], ['s2', 50]])
    expect(shouldStopFormatLoop(FORMAT_MIN_ITERATIONS, scores)).toBe(false)
  })
})

describe('parseFormatRulesResponse — robust against fence + wrapper variations', () => {
  it('accepts a bare { id: "<rules>" } object', () => {
    const parsed = parseFormatRulesResponse('{"s6_2": "Font: Arial 11pt."}')
    expect(parsed).toEqual({ ok: { s6_2: 'Font: Arial 11pt.' } })
  })

  it('accepts a { rules: { id: "<rules>" } } wrapper', () => {
    const parsed = parseFormatRulesResponse('{"rules": {"s6_2": "Font: Arial 11pt."}}')
    expect(parsed).toEqual({ ok: { s6_2: 'Font: Arial 11pt.' } })
  })

  it('strips a ```json fence Claude occasionally adds despite the contract', () => {
    const parsed = parseFormatRulesResponse('```json\n{"s6_2": "Font: Arial 11pt."}\n```')
    expect(parsed).toEqual({ ok: { s6_2: 'Font: Arial 11pt.' } })
  })

  it('ignores keys with invalid id characters so the model can\'t inject arbitrary keys', () => {
    const parsed = parseFormatRulesResponse('{"ok_id": "rules A", "bad key!!": "rules B"}')
    expect('ok' in parsed).toBe(true)
    if ('ok' in parsed) {
      expect(parsed.ok.ok_id).toBe('rules A')
      expect(parsed.ok).not.toHaveProperty('bad key!!')
    }
  })

  it('returns a typed failure for malformed JSON', () => {
    const parsed = parseFormatRulesResponse('not json')
    expect('fail' in parsed).toBe(true)
  })

  it('returns a typed failure when the body is an array, not an object', () => {
    const parsed = parseFormatRulesResponse('[]')
    expect('fail' in parsed).toBe(true)
  })
})
