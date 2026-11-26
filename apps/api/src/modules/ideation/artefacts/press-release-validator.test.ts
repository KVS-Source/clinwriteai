import { describe, it, expect } from 'vitest'
import { validatePressReleaseStructure, isPressReleaseGatedType } from './press-release-validator.js'

describe('isPressReleaseGatedType', () => {
  it('fires only on press_release', () => {
    expect(isPressReleaseGatedType('press_release')).toBe(true)
    expect(isPressReleaseGatedType('patient_story')).toBe(false)
  })
})

describe('validatePressReleaseStructure', () => {
  it('passes a full AP-style release with all 5 elements', () => {
    const html = [
      '<h1>SponsorCo Announces Phase 3 Topline Results</h1>',
      '<p>NEW YORK, March 15, 2026 — SponsorCo today announced positive topline results from the pivotal Phase 3 study.</p>',
      '<p>The study met its primary endpoint of efficacy at week 24.</p>',
      '<p>About SponsorCo: SponsorCo is a global biopharmaceutical company based in New York.</p>',
      '<p>Media Contact: press@sponsorco.example / +1 555 555 0100</p>',
    ].join('')
    const r = validatePressReleaseStructure(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.elementsFound).toEqual(expect.arrayContaining(['headline', 'dateline', 'body', 'boilerplate', 'contact']))
  })

  it('passes with threshold of 3 elements (headline + body + contact)', () => {
    const html = [
      '<h2>Brief Update</h2>',
      '<p>We completed our enrollment milestone this quarter.</p>',
      '<p>Enrollment exceeded 1,200 participants across 42 sites.</p>',
      '<p>Contact: press@sponsorco.example</p>',
    ].join('')
    const r = validatePressReleaseStructure(html)
    expect(r.structurallyValid).toBe(true)
    expect(r.elementsFound).toEqual(expect.arrayContaining(['headline', 'body', 'contact']))
  })

  it('flags a bare prose rewrite that lost headline + dateline + boilerplate + contact', () => {
    const html = '<p>We did a thing this quarter. It went well.</p>'
    const r = validatePressReleaseStructure(html)
    expect(r.structurallyValid).toBe(false)
    expect(r.elementsFound.length).toBeLessThan(3)
  })

  it('gives empty content a free pass', () => {
    const r = validatePressReleaseStructure('')
    expect(r.structurallyValid).toBe(true)
  })

  it('detects a dateline in the AP "CITY, Month DD, YYYY" form', () => {
    const html = '<p>SAN FRANCISCO, January 5, 2026 — Announcement body here.</p>'
    const r = validatePressReleaseStructure(html)
    expect(r.elementsFound).toContain('dateline')
  })

  it('detects a boilerplate "About SponsorCo" block', () => {
    const html = '<p>Earlier body.</p><p>About SponsorCo: SponsorCo has been developing therapies since 1998.</p>'
    const r = validatePressReleaseStructure(html)
    expect(r.elementsFound).toContain('boilerplate')
  })
})
