import { describe, it, expect } from 'vitest'
import { validateDisclaimer, isDisclaimerGatedType } from './disclaimer-validator.js'

describe('isDisclaimerGatedType', () => {
  it('fires on scientific_exchange_note + congress_summary', () => {
    expect(isDisclaimerGatedType('scientific_exchange_note')).toBe(true)
    expect(isDisclaimerGatedType('congress_summary')).toBe(true)
  })
  it('skips other docTypes', () => {
    expect(isDisclaimerGatedType('patient_story')).toBe(false)
    expect(isDisclaimerGatedType('press_release')).toBe(false)
  })
})

describe('validateDisclaimer', () => {
  it('passes when the sponsor-views phrasing survives', () => {
    const html = '<p>The response <strong>represents the views of the sponsor</strong> and is for scientific exchange only.</p>'
    const r = validateDisclaimer(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.phrasesFound.length).toBeGreaterThanOrEqual(1)
  })

  it('passes with the shorter "not promotional" phrasing', () => {
    const html = '<p>This note is educational, not promotional, and does not endorse off-label use.</p>'
    const r = validateDisclaimer(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.phrasesFound).toContain('not promotional')
  })

  it('flags content that lost every disclaimer phrasing', () => {
    const html = '<p>Our product worked best in a subgroup not studied in the pivotal trial.</p>'
    const r = validateDisclaimer(html)
    expect(r.structurallyValid).toBe(false)
    expect(r.phrasesFound).toEqual([])
  })

  it('gives empty content a free pass', () => {
    const r = validateDisclaimer('')
    expect(r.structurallyValid).toBe(true)
  })

  it('is case-insensitive', () => {
    const html = '<p>For SCIENTIFIC EXCHANGE ONLY.</p>'
    const r = validateDisclaimer(html)
    expect(r.structurallyValid).toBe(true)
  })

  it('matches on the "views of the author" variant', () => {
    const html = '<p>The views of the author do not necessarily reflect the sponsor.</p>'
    const r = validateDisclaimer(html)
    expect(r.structurallyValid).toBe(true)
  })
})
