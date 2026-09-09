import { create } from 'zustand'
import type { ReviewComment, ReviewRound, ReviewerTab } from '@platform/types'

interface ReviewStore {
  round: ReviewRound | null
  comments: ReviewComment[]
  activeTab: ReviewerTab
  activeCommentId: string | null
  aiDraftPending: string | null
  setRound: (round: ReviewRound | null) => void
  setComments: (comments: ReviewComment[]) => void
  setActiveTab: (tab: ReviewerTab) => void
  setActiveComment: (id: string | null) => void
  setAiDraftPending: (id: string | null) => void
  updateComment: (id: string, patch: Partial<ReviewComment>) => void
}

export const useReviewStore = create<ReviewStore>(set => ({
  round: null,
  comments: [],
  activeTab: 'r1',
  activeCommentId: null,
  aiDraftPending: null,
  setRound:           (round)     => set({ round }),
  setComments:        (comments)  => set({ comments }),
  setActiveTab:       (activeTab) => set({ activeTab }),
  setActiveComment:   (id)        => set({ activeCommentId: id }),
  setAiDraftPending:  (id)        => set({ aiDraftPending: id }),
  updateComment:      (id, patch) => set(s => ({
    comments: s.comments.map(c => c.id === id ? { ...c, ...patch } : c),
  })),
}))
