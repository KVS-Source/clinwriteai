import { create } from 'zustand'
import type { Document, PanelMode, PresenceState, DocumentVersion } from '@platform/types'

interface DocumentStore {
  documents: Document[]
  activeDocument: Document | null
  activeSection: string | null
  activePanel: PanelMode
  panelWidth: number
  diffVersions: { from: string; to: string } | null // diffMode derived: diffVersions !== null
  selectedForRestore: string[]
  presence: PresenceState[]
  versions: DocumentVersion[]
  setDocuments: (docs: Document[]) => void
  setActiveDocument: (doc: Document | null) => void
  setActiveSection: (id: string | null) => void
  setActivePanel: (panel: PanelMode) => void
  setPanelWidth: (width: number) => void
  toggleDiffMode: (from: string, to: string) => void
  closeDiff: () => void
  toggleSectionForRestore: (sectionId: string) => void
  clearRestoreSelection: () => void
  setPresence: (presence: PresenceState[]) => void
  setVersions: (versions: DocumentVersion[]) => void
}

export const useDocumentStore = create<DocumentStore>(set => ({
  documents: [],
  activeDocument: null,
  activeSection: null,
  activePanel: null,
  panelWidth: 280,
  diffVersions: null,
  selectedForRestore: [],
  presence: [],
  versions: [],
  setDocuments: (documents) => set({ documents }),
  setActiveDocument: (activeDocument) => set({ activeDocument }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
  toggleDiffMode: (from, to) => set({ diffVersions: { from, to } }),
  closeDiff: () => set({ diffVersions: null, selectedForRestore: [] }),
  toggleSectionForRestore: (id) =>
    set(s => ({
      selectedForRestore: s.selectedForRestore.includes(id)
        ? s.selectedForRestore.filter(x => x !== id)
        : [...s.selectedForRestore, id],
    })),
  clearRestoreSelection: () => set({ selectedForRestore: [] }),
  setPresence: (presence) => set({ presence }),
  setVersions: (versions) => set({ versions }),
}))
