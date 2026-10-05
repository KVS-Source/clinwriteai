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
})
