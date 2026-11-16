import { describe, expect, it } from 'vitest'
import { textExcerpt, wordStartPattern } from './search.js'

describe('wordStartPattern', () => {
  it('anchors the term at the start of a word', () => {
    expect(wordStartPattern('test')).toBe('\\mtest')
  })

  it('escapes the characters a regular expression would read as commands', () => {
    expect(wordStartPattern('HbA1c (1.2%)')).toBe('\\mHbA1c \\(1\\.2%\\)')
    expect(wordStartPattern('a+b*c?')).toBe('\\ma\\+b\\*c\\?')
  })
})

describe('textExcerpt', () => {
  it('finds whole words and the words they start: test, tests, testing', () => {
    expect(textExcerpt('Results of the test were clear.', 'test')).toContain('test were clear')
    expect(textExcerpt('All tests passed', 'TEST')).toBe('All tests passed')
    expect(textExcerpt('Repeat testing at week 4', 'test')).toContain('testing')
  })

  it('does not match inside another word', () => {
    expect(textExcerpt('Gastrointestinal events, the latest data', 'test')).toBeNull()
  })

  it('cuts a long text around the match, at word boundaries, with … where it was cut', () => {
    const body = `${'alpha '.repeat(40)}the primary endpoint was met ${'omega '.repeat(40)}`
    const excerpt = textExcerpt(body, 'endpoint')!
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).toContain('the primary endpoint was met')
    expect(excerpt.replace(/…/g, '').split(' ').every(w => ['alpha', 'omega', 'the', 'primary', 'endpoint', 'was', 'met', ''].includes(w))).toBe(true)
    expect(excerpt.length).toBeLessThan(170)
  })

  it('reads the stored text as it is: a "<" in a document does not hide what follows', () => {
    expect(textExcerpt('Dose <5 mg for 3 days. Plans are updated and tested? Yes > no', 'test')).toContain('updated and tested?')
  })

  it('handles an empty text and terms with regex characters', () => {
    expect(textExcerpt(null, 'test')).toBeNull()
    expect(textExcerpt('Reduces HbA1c (1.2%) at week 24', '(1.2%)')).toBeNull()       // starts with "(", not a word
    expect(textExcerpt('Reduces HbA1c (1.2%) at week 24', 'HbA1c (1.2')).toContain('HbA1c (1.2%)')
  })
})
