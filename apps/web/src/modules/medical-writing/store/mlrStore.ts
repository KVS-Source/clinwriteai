import { create } from 'zustand'
import type { MLRReviewer, MLRComment, MLRDecision } from '@platform/types'

interface MLRStore {
  reviewers:               MLRReviewer[]
  comments:                MLRComment[]
  decisionDraft:           MLRDecision | null
  decisionNote:            string
  signatureConfirmed:      boolean
  signaturePassword:       string
  setReviewers:            (r: MLRReviewer[]) => void
  setComments:             (c: MLRComment[]) => void
  setDecisionDraft:        (d: MLRDecision | null) => void
  setDecisionNote:         (note: string) => void
  setSignatureConfirmed:   (v: boolean) => void
  setSignaturePassword:    (pw: string) => void
  resolveComment:          (id: string, resolvedBy: string) => void
}

export const useMLRStore = create<MLRStore>(set => ({
  reviewers:          [],
  comments:           [],
  decisionDraft:      null,
  decisionNote:       '',
  signatureConfirmed: false,
  signaturePassword:  '',
  setReviewers:          (reviewers)          => set({ reviewers }),
  setComments:           (comments)           => set({ comments }),
  setDecisionDraft:      (decisionDraft)      => set({ decisionDraft }),
  setDecisionNote:       (decisionNote)       => set({ decisionNote }),
  setSignatureConfirmed: (signatureConfirmed) => set({ signatureConfirmed }),
  setSignaturePassword:  (signaturePassword)  => set({ signaturePassword }),
  resolveComment:        (id, by)             => set(s => ({
    comments: s.comments.map(c => c.id === id
      ? { ...c, resolvedAt: new Date().toISOString(), resolvedBy: by }
      : c),
  })),
}))
