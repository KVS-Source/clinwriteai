import { describe, it, expect } from 'vitest'
import { AUTHORITY_PINNED_REGION, resolveSubmissionRegion } from './submission-pin.js'
import { CrossBorderBlockedError } from './transfer-gate.js'
import { ConsentRequiredError } from './gate.js'

describe('DPDPA submission-pin', () => {
  it('pins CDSCO to ap-south-1 regardless of tenant default', () => {
    expect(resolveSubmissionRegion({ authority: 'CDSCO', tenantDefaultRegion: 'us-east-1' })).toBe('ap-south-1')
    expect(resolveSubmissionRegion({ authority: 'CDSCO', tenantDefaultRegion: 'eu-west-1' })).toBe('ap-south-1')
    expect(resolveSubmissionRegion({ authority: 'CDSCO', tenantDefaultRegion: 'ap-south-1' })).toBe('ap-south-1')
  })

  it('passes through tenant default for non-India authorities', () => {
    expect(resolveSubmissionRegion({ authority: 'FDA',  tenantDefaultRegion: 'us-east-1' })).toBe('us-east-1')
    expect(resolveSubmissionRegion({ authority: 'EMA',  tenantDefaultRegion: 'eu-west-1' })).toBe('eu-west-1')
    expect(resolveSubmissionRegion({ authority: 'MHRA', tenantDefaultRegion: 'eu-west-2' })).toBe('eu-west-2')
    expect(resolveSubmissionRegion({ authority: 'PMDA', tenantDefaultRegion: 'ap-northeast-1' })).toBe('ap-northeast-1')
  })

  it('only CDSCO is in the pinned-region map today', () => {
    expect(Object.keys(AUTHORITY_PINNED_REGION)).toEqual(['CDSCO'])
  })
})

describe('DPDPA error types', () => {
  it('ConsentRequiredError carries subject + purpose + intake URL', () => {
    const err = new ConsentRequiredError('kol_contact', 'kol-123', 'kol_engagement', '/consent/intake?x=y')
    expect(err.code).toBe('consent_required')
    expect(err.subjectType).toBe('kol_contact')
    expect(err.subjectId).toBe('kol-123')
    expect(err.purpose).toBe('kol_engagement')
    expect(err.intakeUrl).toBe('/consent/intake?x=y')
    expect(err.message).toContain('kol-123')
  })

  it('CrossBorderBlockedError carries tenant + destination details', () => {
    const err = new CrossBorderBlockedError('tenant-abc', 'us-east-1', 'US')
    expect(err.code).toBe('cross_border_blocked')
    expect(err.tenantId).toBe('tenant-abc')
    expect(err.destinationRegion).toBe('us-east-1')
    expect(err.destinationCountry).toBe('US')
    expect(err.message).toContain('IN-residency tenant')
  })
})
