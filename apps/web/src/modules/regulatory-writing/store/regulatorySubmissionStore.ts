import { create } from 'zustand'
import type { RegulatorySubmission, SubmissionStatus } from '@platform/types'

export type RegPanelMode =
  | 'canonical-json' | 'cmc-readiness' | 'ectd-map' | 'consistency' | 'audit' | null

interface RegulatorySubmissionStore {
  submissions:        RegulatorySubmission[]
  activeSubmissionId: string | null
  activePanel:        RegPanelMode
  statusFilter:       SubmissionStatus | 'all'
  taFilter:           string | 'all'
  searchQuery:        string
  setSubmissions:        (items: RegulatorySubmission[]) => void
  setActiveSubmissionId: (id: string | null) => void
  setActivePanel:        (panel: RegPanelMode) => void
  setStatusFilter:       (s: SubmissionStatus | 'all') => void
  setTaFilter:           (ta: string | 'all') => void
  setSearchQuery:        (q: string) => void
}

export const useRegulatorySubmissionStore = create<RegulatorySubmissionStore>(set => ({
  submissions:        [],
  activeSubmissionId: null,
  activePanel:        null,
  statusFilter:       'all',
  taFilter:           'all',
  searchQuery:        '',
  setSubmissions:        (submissions)        => set({ submissions }),
  setActiveSubmissionId: (activeSubmissionId) => set({ activeSubmissionId }),
  setActivePanel:        (activePanel)        => set({ activePanel }),
  setStatusFilter:       (statusFilter)       => set({ statusFilter }),
  setTaFilter:           (taFilter)           => set({ taFilter }),
  setSearchQuery:        (searchQuery)        => set({ searchQuery }),
}))
