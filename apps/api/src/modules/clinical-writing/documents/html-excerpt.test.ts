import { describe, expect, it } from 'vitest'
import { htmlExcerpt } from './html-excerpt.js'

describe('htmlExcerpt', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlExcerpt('<p>Hello <strong>world</strong>.</p>')).toBe('Hello world.')
  })

  it('inserts a space between adjacent block elements so words do not glue', () => {
    expect(htmlExcerpt('<p>Paragraph one.</p><p>Paragraph two.</p>'))
      .toBe('Paragraph one. Paragraph two.')
  })

  it('decodes the handful of entities we commonly produce', () => {
    expect(htmlExcerpt('<p>5 &amp; 3 &lt; 10 &nbsp;&quot;ok&quot;</p>'))
      .toBe('5 & 3 < 10 "ok"')
  })

  it('returns the empty string for null / undefined / empty input', () => {
    expect(htmlExcerpt(null)).toBe('')
    expect(htmlExcerpt(undefined)).toBe('')
    expect(htmlExcerpt('')).toBe('')
    expect(htmlExcerpt('<p></p>')).toBe('')
  })

  it('truncates on a word boundary when the content exceeds maxChars', () => {
    const long = '<p>' + 'word '.repeat(60) + '</p>'
    const out  = htmlExcerpt(long, 40)
    expect(out).toMatch(/…$/)                            // trailing ellipsis
    expect(out.length).toBeLessThanOrEqual(41)           // 40 + ellipsis
    expect(out).not.toMatch(/wor…$/)                     // not mid-word
  })

  it('falls back to a hard cut when there is no reasonable word boundary', () => {
    const noSpaces = '<p>' + 'a'.repeat(300) + '</p>'
    const out = htmlExcerpt(noSpaces, 50)
    expect(out).toBe('a'.repeat(50) + '…')
  })

  it('does not add an ellipsis when exactly at maxChars', () => {
    const exact = '<p>' + 'x'.repeat(20) + '</p>'
    expect(htmlExcerpt(exact, 20)).toBe('x'.repeat(20))
  })

  it('handles lists + headings without jamming words together', () => {
    expect(htmlExcerpt('<h3>Section</h3><ul><li>One</li><li>Two</li></ul>'))
      .toBe('Section One Two')
  })
})
