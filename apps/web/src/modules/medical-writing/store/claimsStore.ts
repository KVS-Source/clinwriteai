import { create } from 'zustand'
import type { MedClaim, ClaimStatus } from '@platform/types'

interface ClaimsStore {
  claims:              MedClaim[]
  statusFilter:        ClaimStatus | 'all'
  selectedClaimId:     string | null
  gateStats: { approved: number; modified: number; new: number; mustFix: number }
  setClaims:            (claims: MedClaim[]) => void
  setStatusFilter:      (status: ClaimStatus | 'all') => void
  setSelectedClaimId:   (id: string | null) => void
  updateClaim:          (id: string, patch: Partial<MedClaim>) => void
}

function computeGateStats(claims: MedClaim[]) {
  return {
    approved: claims.filter(c => c.approvalStatus === 'approved').length,
    modified: claims.filter(c => c.approvalStatus === 'modified').length,
    new:      claims.filter(c => c.approvalStatus === 'new').length,
    mustFix:  claims.filter(c => c.approvalStatus === 'must-fix').length,
  }
}

export const useClaimsStore = create<ClaimsStore>(set => ({
  claims:          [],
  statusFilter:    'all',
  selectedClaimId: null,
  gateStats: { approved: 0, modified: 0, new: 0, mustFix: 0 },
  setClaims:          (claims)          => set({ claims, gateStats: computeGateStats(claims) }),
  setStatusFilter:    (statusFilter)    => set({ statusFilter }),
  setSelectedClaimId: (selectedClaimId) => set({ selectedClaimId }),
  updateClaim:        (id, patch)       => set(s => {
    const next = s.claims.map(c => c.id === id ? { ...c, ...patch } : c)
    return { claims: next, gateStats: computeGateStats(next) }
  }),
}))
