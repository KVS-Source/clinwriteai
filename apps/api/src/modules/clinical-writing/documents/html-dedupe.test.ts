import { describe, expect, it } from 'vitest'
import { areSectionHtmlsVisiblyEqual, normalizeHtmlForDedupe } from './html-dedupe.js'

describe('normalizeHtmlForDedupe', () => {
  it('returns empty for null / undefined / empty', () => {
    expect(normalizeHtmlForDedupe(null)).toBe('')
    expect(normalizeHtmlForDedupe(undefined)).toBe('')
    expect(normalizeHtmlForDedupe('')).toBe('')
  })

  it('drops empty <p> variants so a jittering editor adds no diff', () => {
    expect(normalizeHtmlForDedupe('<p>A</p><p></p>')).toBe('<p>A</p>')
    expect(normalizeHtmlForDedupe('<p>A</p><p><br/></p>')).toBe('<p>A</p>')
    expect(normalizeHtmlForDedupe('<p>A</p><p>  <br />  </p>')).toBe('<p>A</p>')
  })

  it('collapses whitespace between tags + inside text', () => {
    expect(normalizeHtmlForDedupe('<p>A</p>   <p>B</p>')).toBe('<p>A</p><p>B</p>')
    expect(normalizeHtmlForDedupe('<p>A  B    C</p>')).toBe('<p>A B C</p>')
  })

  it('folds non-breaking spaces to regular spaces', () => {
    expect(normalizeHtmlForDedupe('<p>A&nbsp;B</p>')).toBe('<p>A B</p>')
  })
})

describe('areSectionHtmlsVisiblyEqual', () => {
  it('treats TipTap whitespace jitter as equal', () => {
    expect(areSectionHtmlsVisiblyEqual(
      '<p>The study is open-label.</p>',
      '<p>The study is open-label.</p><p></p>',
    )).toBe(true)
    expect(areSectionHtmlsVisiblyEqual(
      '<p>A</p>\n<p>B</p>',
      '<p>A</p><p>B</p>',
    )).toBe(true)
  })

  it('still flags a real text change as different', () => {
    expect(areSectionHtmlsVisiblyEqual(
      '<p>Patients received 10mg daily.</p>',
      '<p>Patients received 20mg daily.</p>',
    )).toBe(false)
  })

  it('still flags a real markup change as different', () => {
    expect(areSectionHtmlsVisiblyEqual(
      '<p>Bold required.</p>',
      '<p><strong>Bold required.</strong></p>',
    )).toBe(false)
  })

  it('still flags a placeholder transition as different', () => {
    expect(areSectionHtmlsVisiblyEqual(
      '<p>[TBD: sponsor name]</p>',
      '<p>Acme Pharma, Inc.</p>',
    )).toBe(false)
  })
})
