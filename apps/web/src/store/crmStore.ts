import { create } from 'zustand'
import type { CRMMeeting, CRMResolution } from '@platform/types'

interface CRMStore {
  meeting: CRMMeeting | null
  activeCommentId: string | null
  resolutionDraft: Partial<CRMResolution> | null
  setMeeting: (meeting: CRMMeeting | null) => void
  setActiveComment: (id: string | null) => void
  setResolutionDraft: (draft: Partial<CRMResolution> | null) => void
  saveResolution: (resolution: CRMResolution) => void
}

export const useCRMStore = create<CRMStore>(set => ({
  meeting: null,
  activeCommentId: null,
  resolutionDraft: null,
  setMeeting: (meeting) => set({ meeting }),
  setActiveComment: (activeCommentId) => set({ activeCommentId }),
  setResolutionDraft: (resolutionDraft) => set({ resolutionDraft }),
  saveResolution: (resolution) =>
    set(s => ({
      resolutionDraft: null,
      meeting: s.meeting ? {
        ...s.meeting,
        resolvedIds: [...s.meeting.resolvedIds, resolution.commentId],
        activeId: null,
      } : null,
    })),
}))
