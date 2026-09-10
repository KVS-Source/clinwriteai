import { create } from 'zustand'
import type { CalendarEntry, SocialListeningAlert } from '@platform/types'

type CalendarView = 'month' | 'week'

interface CalendarStore {
  entries:          CalendarEntry[]
  view:             CalendarView
  focusMonth:       string
  socialAlerts:     SocialListeningAlert[]
  setEntries:       (e: CalendarEntry[]) => void
  setView:          (v: CalendarView) => void
  setFocusMonth:    (m: string) => void
  setSocialAlerts:  (a: SocialListeningAlert[]) => void
  markPublished:    (id: string, publishedBy: string) => void
  resolveAlert:     (id: string, resolvedBy: string, note: string) => void
}

export const useCalendarStore = create<CalendarStore>(set => ({
  entries:      [],
  view:         'month',
  focusMonth:   '2026-10',
  socialAlerts: [],
  setEntries:      (entries)      => set({ entries }),
  setView:         (view)         => set({ view }),
  setFocusMonth:   (focusMonth)   => set({ focusMonth }),
  setSocialAlerts: (socialAlerts) => set({ socialAlerts }),
  markPublished:   (id, publishedBy) => set(s => ({
    entries: s.entries.map(e => e.id === id ? {
      ...e, status: 'published', publishedAt: new Date().toISOString(), publishedBy, isOverdue: false,
    } : e),
  })),
  resolveAlert: (id, resolvedBy, note) => set(s => ({
    socialAlerts: s.socialAlerts.map(a => a.id === id ? {
      ...a, resolvedAt: new Date().toISOString(), resolvedBy, resolvedByName: resolvedBy, resolutionNote: note,
    } : a),
  })),
}))
