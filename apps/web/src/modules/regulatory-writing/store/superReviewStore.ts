import { create } from 'zustand'
import type { ConsistencyCheckResult, ConsistencySeverity, SuperReviewer } from '@platform/types'

export type SuperReviewTab = 'consistency' | 'discipline' | 'signoff'

interface Comment {
  id:         string
  authorId:   string
  authorName: string
  text:       string
  createdAt:  string
  tag:        'clinical' | 'safety' | 'cmc' | 'admin' | 'consistency'
}

interface SuperReviewStore {
  reviewers:         SuperReviewer[]
  comments:          Comment[]
  consistencyResult: ConsistencyCheckResult | null
  activeTab:         SuperReviewTab
  isRunningCheck:    boolean
  setReviewers:         (r: SuperReviewer[]) => void
  setComments:          (c: Comment[]) => void
  setConsistencyResult: (r: ConsistencyCheckResult | null) => void
  setActiveTab:         (t: SuperReviewTab) => void
  setRunningCheck:      (v: boolean) => void
  resolveContradiction: (id: string, by: string, note: string) => void
  markSigned:           (reviewerId: string, at?: string) => void
}

function computeSignedCount(reviewers: SuperReviewer[]): number {
  return reviewers.filter(r => !!r.signedAt).length
}

function hasUnresolvedMajor(result: ConsistencyCheckResult | null): boolean {
  if (!result) return false
  return result.contradictions.some(c => c.severity === 'major' && !c.resolved)
}

export function isStage5Blocked(result: ConsistencyCheckResult | null, majorOnly: ConsistencySeverity = 'major'): boolean {
  if (!result) return false
  return result.contradictions.some(c => c.severity === majorOnly && !c.resolved)
}

export const useSuperReviewStore = create<SuperReviewStore>(set => ({
  reviewers:         [],
  comments:          [],
  consistencyResult: null,
  activeTab:         'consistency',
  isRunningCheck:    false,
  setReviewers:         (reviewers)         => set({ reviewers }),
  setComments:          (comments)          => set({ comments }),
  setConsistencyResult: (consistencyResult) => set({ consistencyResult }),
  setActiveTab:         (activeTab)         => set({ activeTab }),
  setRunningCheck:      (isRunningCheck)    => set({ isRunningCheck }),
  resolveContradiction: (id, by, note) => set(s => {
    if (!s.consistencyResult) return {}
    const next = {
      ...s.consistencyResult,
      contradictions: s.consistencyResult.contradictions.map(c => c.id === id ? {
        ...c, resolved: true, resolvedBy: by, resolvedAt: new Date().toISOString(), resolutionNote: note,
      } : c),
    }
    next.passed = !hasUnresolvedMajor(next)
    return { consistencyResult: next }
  }),
  markSigned: (reviewerId, at) => set(s => {
    const stamp = at ?? new Date().toISOString()
    const reviewers = s.reviewers.map(r => r.id === reviewerId ? { ...r, signedAt: stamp } : r)
    return { reviewers, signedCount: computeSignedCount(reviewers) }
  }),
}))
