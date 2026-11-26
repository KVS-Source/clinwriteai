import { describe, it, expect } from 'vitest'
import { validateConsentDisclosure, isConsentGatedType } from './consent-validator.js'

describe('isConsentGatedType', () => {
  it('fires on patient_story only', () => {
    expect(isConsentGatedType('patient_story')).toBe(true)
    expect(isConsentGatedType('press_release')).toBe(false)
    expect(isConsentGatedType('kol_engagement_brief')).toBe(false)
  })
})

describe('validateConsentDisclosure', () => {
  it('passes a patient story that carries a Consent label', () => {
    const html = '<p>I was diagnosed in 2024.</p><p>Consent: The patient has provided written consent for publication.</p>'
    const r = validateConsentDisclosure(html)
    expect(r.looksLikePatientStory).toBe(true)
    expect(r.structurallyValid).toBe(true)
    expect(r.labelsFound).toContain('Consent')
  })

  it('passes a patient story that carries a Disclosures label', () => {
    const html = '<p>My treatment journey.</p><p>Disclosures: Funded by SponsorCo. No competing interests.</p>'
    const r = validateConsentDisclosure(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.labelsFound).toContain('Disclosures')
  })

  it('flags a patient-first-person narrative that dropped all consent labels', () => {
    const html = '<p>I was diagnosed with the condition last year. My doctor recommended a new course of treatment.</p>'
    const r = validateConsentDisclosure(html)
    expect(r.looksLikePatientStory).toBe(true)
    expect(r.structurallyValid).toBe(false)
    expect(r.labelsFound).toEqual([])
    expect(r.missingLabels.length).toBeGreaterThan(0)
  })

  it('gives empty content a free pass (not yet-authored)', () => {
    const r = validateConsentDisclosure('')
    expect(r.looksLikePatientStory).toBe(false)
    expect(r.structurallyValid).toBe(true)
  })

  it('does not match a label embedded in another word (COI vs coincidence)', () => {
    // No label, no first-person cue → not detected as patient story → free pass
    const html = '<p>By coincidence, the trial enrolled first-born siblings.</p>'
    const r = validateConsentDisclosure(html)
    expect(r.labelsFound).toEqual([])
    expect(r.looksLikePatientStory).toBe(false)
  })

  it('accepts bold-wrapped and em-wrapped labels', () => {
    const html = '<p>I share my story.</p><p><strong>Informed Consent:</strong> Written consent obtained.</p>'
    const r = validateConsentDisclosure(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.labelsFound).toContain('Informed Consent')
  })
})
