import { create } from 'zustand'
import type { PublicationAuthor } from '@platform/types'

interface AuthorStore {
  authors: PublicationAuthor[]
  expandedAuthorId: string | null
  debarmentCheckPending: string | null
  setAuthors: (authors: PublicationAuthor[]) => void
  setExpandedAuthor: (id: string | null) => void
  setDebarmentCheckPending: (id: string | null) => void
  updateAuthor: (id: string, patch: Partial<PublicationAuthor>) => void
}

export const useAuthorStore = create<AuthorStore>(set => ({
  authors: [],
  expandedAuthorId: null,
  debarmentCheckPending: null,
  setAuthors:               (authors)  => set({ authors }),
  setExpandedAuthor:        (id)       => set({ expandedAuthorId: id }),
  setDebarmentCheckPending: (id)       => set({ debarmentCheckPending: id }),
  updateAuthor:             (id, patch) => set(s => ({
    authors: s.authors.map(a => a.id === id ? { ...a, ...patch } : a),
  })),
}))
