import { describe, expect, it } from 'vitest'
import { deriveOverallStatus } from './card-status.js'

describe('deriveOverallStatus', () => {
  it('fresh card with both reviewers pending → uploaded', () => {
    expect(deriveOverallStatus({ kolStatus: 'pending', maStatus: 'pending', wasSeen: false })).toBe('uploaded')
  })

  it('seen card with both reviewers pending → under_review', () => {
    expect(deriveOverallStatus({ kolStatus: 'pending', maStatus: 'pending', wasSeen: true })).toBe('under_review')
  })

  it('kol approved + ma pending → reviewed', () => {
    expect(deriveOverallStatus({ kolStatus: 'approved', maStatus: 'pending', wasSeen: true })).toBe('reviewed')
  })

  it('both approved → approved', () => {
    expect(deriveOverallStatus({ kolStatus: 'approved', maStatus: 'approved', wasSeen: true })).toBe('approved')
  })

  it('any rejection → rejected (regardless of other side)', () => {
    expect(deriveOverallStatus({ kolStatus: 'rejected', maStatus: 'approved', wasSeen: true })).toBe('rejected')
    expect(deriveOverallStatus({ kolStatus: 'approved', maStatus: 'rejected', wasSeen: true })).toBe('rejected')
    expect(deriveOverallStatus({ kolStatus: 'rejected', maStatus: 'rejected', wasSeen: true })).toBe('rejected')
  })

  it('ma approved + kol pending → under_review (kol must speak)', () => {
    expect(deriveOverallStatus({ kolStatus: 'pending', maStatus: 'approved', wasSeen: true })).toBe('under_review')
  })
})
