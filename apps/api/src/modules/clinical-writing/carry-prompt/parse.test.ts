// Unit tests for parseFlagTokens + summariseFlagTokens.

import { describe, expect, it } from 'vitest'
import { parseFlagTokens, summariseFlagTokens } from './parse.js'

describe('parseFlagTokens', () => {
  it('returns [] for empty / nullish-ish inputs', () => {
    expect(parseFlagTokens('')).toEqual([])
  })

  it('returns [] when the text has no flag tokens', () => {
    expect(parseFlagTokens('<p>The primary endpoint was PFS.</p>')).toEqual([])
  })

  it('extracts an Information Required token with its body', () => {
    const tokens = parseFlagTokens('The dose was [Information Required: confirm mg per kg].')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({
      type:  'information_required',
      text:  'confirm mg per kg',
      match: '[Information Required: confirm mg per kg]',
    })
    expect(tokens[0]!.start).toBe(13)
  })

  it('maps each canonical label to the right type', () => {
    const text = [
      '[Information Required: a]',
      '[Conflict: x vs y]',
      '[Reference Verification Required: ref-1]',
      '[Missing Cross-Ref Target: Table 7]',
    ].join(' ')
    const tokens = parseFlagTokens(text)
    expect(tokens.map(t => t.type)).toEqual([
      'information_required',
      'conflict',
      'reference_verification_required',
      'missing_cross_ref_target',
    ])
  })

  it('matches labels case-insensitively', () => {
    const tokens = parseFlagTokens('[INFORMATION REQUIRED: x] [conflict: a vs b]')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]?.type).toBe('information_required')
    expect(tokens[1]?.type).toBe('conflict')
  })

  it('trims the body (leading / trailing whitespace)', () => {
    const tokens = parseFlagTokens('[Information Required:    needs confirmation   ]')
    expect(tokens[0]?.text).toBe('needs confirmation')
  })

  it('surfaces an empty body (model emitted the token with no details)', () => {
    const tokens = parseFlagTokens('[Information Required: ]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.text).toBe('')
  })

  it('returns positions that correctly bound the literal match', () => {
    const text = 'prefix [Conflict: a vs b] suffix'
    const t = parseFlagTokens(text)[0]!
    expect(text.slice(t.start, t.end)).toBe('[Conflict: a vs b]')
  })

  it('finds multiple tokens of the same type in one pass', () => {
    const tokens = parseFlagTokens('[Information Required: x][Information Required: y]')
    expect(tokens).toHaveLength(2)
    expect(tokens.map(t => t.text)).toEqual(['x', 'y'])
  })

  it('does not match bracketed text that is not a known label', () => {
    expect(parseFlagTokens('[note: ignore me]')).toEqual([])
    expect(parseFlagTokens('[TBD: fill in]')).toEqual([])
  })

  it('is safe to call twice on the same text (regex lastIndex reset)', () => {
    const text = '[Conflict: a vs b]'
    expect(parseFlagTokens(text)).toEqual(parseFlagTokens(text))
  })

  it('stops the body at the next closing bracket (no nesting)', () => {
    const tokens = parseFlagTokens('[Information Required: see [Table 3]] rest')
    expect(tokens).toHaveLength(1)
    // Body ran up to (not past) the first `]`, so 'see [Table 3' is the body.
    expect(tokens[0]?.text).toBe('see [Table 3')
  })
})

describe('summariseFlagTokens', () => {
  it('counts zero across every type for an empty token list', () => {
    expect(summariseFlagTokens([])).toEqual({
      information_required:            0,
      conflict:                        0,
      reference_verification_required: 0,
      missing_cross_ref_target:        0,
    })
  })

  it('counts per type', () => {
    const tokens = parseFlagTokens([
      '[Information Required: a]',
      '[Information Required: b]',
      '[Conflict: x vs y]',
    ].join(' '))
    expect(summariseFlagTokens(tokens)).toMatchObject({
      information_required: 2,
      conflict:             1,
    })
  })
})
