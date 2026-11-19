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
  // TBD panel → editor hand-off. When the writer clicks a TBD occurrence
  // the panel sets this to { sectionId, placeholder }; DocumentEditor's
  // effect scrolls the TBD text into view after the section renders,
  // then clears the field. `nonce` forces re-firing when the same TBD
  // is clicked twice in a row.
  pendingTbdFocus: { sectionId: string; placeholder: string; nonce: number } | null
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
  focusTbd: (sectionId: string, placeholder: string) => void
  clearTbdFocus: () => void
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
  pendingTbdFocus: null,
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
  focusTbd: (sectionId, placeholder) =>
    set({ pendingTbdFocus: { sectionId, placeholder, nonce: Date.now() } }),
  clearTbdFocus: () => set({ pendingTbdFocus: null }),
}))
