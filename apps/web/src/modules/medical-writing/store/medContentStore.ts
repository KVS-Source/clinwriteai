import { create } from 'zustand'
import type { MedContentItem, MedContentStatus, ComplianceTrack } from '@platform/types'

export type MedPanelMode =
  | 'claims' | 'fk-gauge' | 'ai-suggest' | 'references' | 'audit' | null

interface MedContentStore {
  contents:         MedContentItem[]
  activeContentId:  string | null
  activePanel:      MedPanelMode
  statusFilter:     MedContentStatus | 'all'
  trackFilter:      ComplianceTrack | 'all'
  searchQuery:      string
  setContents:        (items: MedContentItem[]) => void
  setActiveContentId: (id: string | null) => void
  setActivePanel:     (panel: MedPanelMode) => void
  setStatusFilter:    (s: MedContentStatus | 'all') => void
  setTrackFilter:     (t: ComplianceTrack | 'all') => void
  setSearchQuery:     (q: string) => void
}

export const useMedContentStore = create<MedContentStore>(set => ({
  contents:        [],
  activeContentId: null,
  activePanel:     null,
  statusFilter:    'all',
  trackFilter:     'all',
  searchQuery:     '',
  setContents:        (contents)        => set({ contents }),
  setActiveContentId: (activeContentId) => set({ activeContentId }),
  setActivePanel:     (activePanel)     => set({ activePanel }),
  setStatusFilter:    (statusFilter)    => set({ statusFilter }),
  setTrackFilter:     (trackFilter)     => set({ trackFilter }),
  setSearchQuery:     (searchQuery)     => set({ searchQuery }),
}))
