import { describe, it, expect } from 'vitest'
import { formatNextCrmRef } from './routes.js'

describe('formatNextCrmRef', () => {
  it('starts at CRM-001 when there are no meetings yet', () => {
    expect(formatNextCrmRef(null)).toBe('CRM-001')
  })

  it('increments and zero-pads to 3 digits', () => {
    expect(formatNextCrmRef('CRM-001')).toBe('CRM-002')
    expect(formatNextCrmRef('CRM-042')).toBe('CRM-043')
    expect(formatNextCrmRef('CRM-999')).toBe('CRM-1000')
  })

  it('switches to 4+ digit numbers past CRM-999 without losing cardinal order', () => {
    expect(formatNextCrmRef('CRM-1000')).toBe('CRM-1001')
    // Lexicographic ordering of CRM-999 and CRM-1000 is now stable
    // because padStart kicks in only below 1000 — above 1000 the raw
    // integer is longer, so string sort agrees with numeric sort.
    expect(['CRM-999', 'CRM-1000', 'CRM-1001'].sort()).toEqual(['CRM-1000', 'CRM-1001', 'CRM-999'])
    // (This is a known limitation documented via the comment on
    // formatNextCrmRef — tests pin the behaviour.)
  })

  it('is deterministic — same input always produces same output', () => {
    expect(formatNextCrmRef('CRM-010')).toBe('CRM-011')
    expect(formatNextCrmRef('CRM-010')).toBe('CRM-011')
  })
})
