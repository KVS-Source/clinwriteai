// CRM store — scoped by meetingId so concurrent CRM meetings on
// different documents can't bleed state into each other.
//
// Before: a single `meeting / activeCommentId / resolutionDraft`
// triple at the top of the store. When an R switched between two docs
// that both had live CRMs, saveResolution's optimistic mutate ran
// against whichever meeting happened to be in the store at that moment
// — a race window of one render if the fetch for the new doc hadn't
// resolved. Server state was always correct; the UI self-healed on the
// next poll but could flash the wrong list for a frame.
//
// After: state is keyed by meetingId. The screen passes `meetingId` on
// every getter/setter and the store returns null when the key doesn't
// match (safe default — the screen fetches fresh from the server).
// resolutionDraft is per-meeting too, so a half-typed draft on Doc A
// doesn't follow the user to Doc B.

import { create } from 'zustand'
import type { CRMMeeting, CRMResolution } from '@platform/types'

interface CRMEntry {
  meeting: CRMMeeting
  activeCommentId: string | null
  resolutionDraft: Partial<CRMResolution> | null
}

interface CRMStore {
  /** Map of meetingId → that meeting's local UI state. */
  entries: Record<string, CRMEntry>

  // ----- Readers that ignore stale keys ------------------------------
  getMeeting:         (meetingId: string | null | undefined) => CRMMeeting | null
  getActiveComment:   (meetingId: string | null | undefined) => string | null
  getResolutionDraft: (meetingId: string | null | undefined) => Partial<CRMResolution> | null

  // ----- Writers scoped by meetingId ---------------------------------
  setMeeting:         (meeting: CRMMeeting | null) => void
  setActiveComment:   (meetingId: string, id: string | null) => void
  setResolutionDraft: (meetingId: string, draft: Partial<CRMResolution> | null) => void
  saveResolution:     (meetingId: string, resolution: CRMResolution) => void

  // ----- Lifecycle ---------------------------------------------------
  /** Drop a meeting entry entirely (e.g. the meeting completed / was cancelled). */
  dropMeeting:        (meetingId: string) => void
}

export const useCRMStore = create<CRMStore>((set, get) => ({
  entries: {},

  getMeeting:         (id) => (id ? get().entries[id]?.meeting ?? null : null),
  getActiveComment:   (id) => (id ? get().entries[id]?.activeCommentId ?? null : null),
  getResolutionDraft: (id) => (id ? get().entries[id]?.resolutionDraft ?? null : null),

  setMeeting: (meeting) => {
    if (!meeting) return
    set(s => ({
      entries: {
        ...s.entries,
        [meeting.id]: {
          meeting,
          activeCommentId: s.entries[meeting.id]?.activeCommentId ?? null,
          resolutionDraft: s.entries[meeting.id]?.resolutionDraft ?? null,
        },
      },
    }))
  },

  setActiveComment: (meetingId, activeCommentId) => {
    set(s => {
      const entry = s.entries[meetingId]
      if (!entry) return s
      return { entries: { ...s.entries, [meetingId]: { ...entry, activeCommentId } } }
    })
  },

  setResolutionDraft: (meetingId, resolutionDraft) => {
    set(s => {
      const entry = s.entries[meetingId]
      if (!entry) return s
      return { entries: { ...s.entries, [meetingId]: { ...entry, resolutionDraft } } }
    })
  },

  saveResolution: (meetingId, resolution) => {
    set(s => {
      const entry = s.entries[meetingId]
      if (!entry) return s
      return {
        entries: {
          ...s.entries,
          [meetingId]: {
            meeting: {
              ...entry.meeting,
              resolvedIds: [...entry.meeting.resolvedIds, resolution.commentId],
              activeId:    null,
            },
            activeCommentId: null,
            resolutionDraft: null,
          },
        },
      }
    })
  },

  dropMeeting: (meetingId) => {
    set(s => {
      if (!s.entries[meetingId]) return s
      const { [meetingId]: _dropped, ...rest } = s.entries
      return { entries: rest }
    })
  },
}))
