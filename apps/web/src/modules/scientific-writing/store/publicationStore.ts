import { create } from 'zustand'
import type { Publication, PublicationStage } from '@platform/types'

export type PanelModeB =
  | 'footprint' | 'suggest' | 'literature' | 'tlf' | 'balance' | 'consort' | null

interface PublicationStore {
  publications: Publication[]
  activePublication: Publication | null
  stageFilter: PublicationStage | 'all'
  searchQuery: string
  activePanel: PanelModeB
  panelWidth: number
  setPublications: (publications: Publication[]) => void
  setActivePublication: (pub: Publication | null) => void
  setStageFilter: (stage: PublicationStage | 'all') => void
  setSearchQuery: (query: string) => void
  setActivePanel: (panel: PanelModeB) => void
  setPanelWidth: (width: number) => void
}

export const usePublicationStore = create<PublicationStore>(set => ({
  publications: [],
  activePublication: null,
  stageFilter: 'all',
  searchQuery: '',
  activePanel: 'footprint',
  panelWidth: 280,
  setPublications:      (publications)      => set({ publications }),
  setActivePublication: (activePublication) => set({ activePublication }),
  setStageFilter:       (stageFilter)       => set({ stageFilter }),
  setSearchQuery:       (searchQuery)       => set({ searchQuery }),
  setActivePanel:       (activePanel)       => set({ activePanel }),
  setPanelWidth:        (panelWidth)        => set({ panelWidth }),
}))
