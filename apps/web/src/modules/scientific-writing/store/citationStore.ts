import { create } from 'zustand'
import type { Citation } from '@platform/types'

interface CitationStore {
  citations: Citation[]
  selectedCitationId: string | null
  searchQuery: string
  setCitations: (citations: Citation[]) => void
  setSelectedCitation: (id: string | null) => void
  setSearchQuery: (query: string) => void
  addCitation: (citation: Citation) => void
  removeCitation: (id: string) => void
}

export const useCitationStore = create<CitationStore>(set => ({
  citations: [],
  selectedCitationId: null,
  searchQuery: '',
  setCitations:        (citations)        => set({ citations }),
  setSelectedCitation: (id)               => set({ selectedCitationId: id }),
  setSearchQuery:      (searchQuery)      => set({ searchQuery }),
  addCitation:         (citation)         => set(s => ({ citations: [...s.citations, citation] })),
  removeCitation:      (id)               => set(s => ({ citations: s.citations.filter(c => c.id !== id) })),
}))
