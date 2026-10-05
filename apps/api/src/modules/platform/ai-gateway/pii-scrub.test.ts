import { describe, expect, it } from 'vitest'
import { scrubPii } from './pii-scrub.js'

describe('scrubPii', () => {
  it('leaves clean prompts untouched', () => {
    const r = scrubPii('Summarise the clinical trial outcomes for sponsor review.')
    expect(r.scrubbed).toBe('Summarise the clinical trial outcomes for sponsor review.')
    expect(r.piiFound).toBe(false)
    expect(r.categories).toEqual([])
  })

  it('redacts email addresses', () => {
    const r = scrubPii('Send to jane.doe@example.com please')
    expect(r.scrubbed).toContain('[REDACTED_EMAIL]')
    expect(r.scrubbed).not.toContain('jane.doe')
    expect(r.categories).toContain('email')
  })

  it('redacts US SSNs', () => {
    const r = scrubPii('Patient SSN 123-45-6789 on file.')
    expect(r.scrubbed).toContain('[REDACTED_SSN]')
    expect(r.categories).toContain('ssn')
  })

  it('redacts phone numbers in common formats', () => {
    const r = scrubPii('Call 555-123-4567 or 1 (555) 123-4567')
    expect(r.scrubbed).toContain('[REDACTED_PHONE]')
    expect(r.scrubbed).not.toContain('555-123-4567')
    expect(r.categories).toContain('phone')
  })

  it('redacts credit-card-length digit runs', () => {
    const r = scrubPii('card 4111 1111 1111 1111 expires soon')
    expect(r.scrubbed).toContain('[REDACTED_CARD]')
    expect(r.categories).toContain('credit_card')
  })

  it('records multiple categories on a single pass', () => {
    const r = scrubPii('Email jane@example.com from 555-123-4567')
    expect(r.piiFound).toBe(true)
    expect(r.categories).toEqual(expect.arrayContaining(['email', 'phone']))
  })

  it('redacts MRN with label anchor', () => {
    const r = scrubPii('Patient MRN 1234567 flagged for review.')
    expect(r.scrubbed).toContain('[REDACTED_MRN]')
    expect(r.scrubbed).not.toContain('1234567')
    expect(r.categories).toContain('mrn')
  })

  it('redacts MRN with alternate labels', () => {
    const r1 = scrubPii('See MR# 9876543 in chart.')
    expect(r1.categories).toContain('mrn')
    const r2 = scrubPii('Medical Record Number: 1234567890')
    expect(r2.categories).toContain('mrn')
  })

  it('does NOT false-positive bare 7-digit runs without MRN label', () => {
    const r = scrubPii('Study identifier 1234567 — randomisation record.')
    expect(r.categories).not.toContain('mrn')
  })

  it('redacts NHS numbers (3-3-4 grouping)', () => {
    const r = scrubPii('NHS number 123 456 7890 on referral.')
    expect(r.scrubbed).toContain('[REDACTED_NHS]')
    expect(r.scrubbed).not.toContain('123 456 7890')
    expect(r.categories).toContain('nhs')
  })

  it('redacts DEA numbers', () => {
    const r = scrubPii('Prescriber DEA AB1234567 verified.')
    expect(r.scrubbed).toContain('[REDACTED_DEA]')
    expect(r.scrubbed).not.toContain('AB1234567')
    expect(r.categories).toContain('dea')
  })

  it('does NOT match DEA shape with wrong first-letter class', () => {
    // 'C' is not in the first-char class [ABFGMPRX]; must not match.
    const r = scrubPii('Reference code CZ1234567 is non-DEA.')
    expect(r.categories).not.toContain('dea')
  })
})
