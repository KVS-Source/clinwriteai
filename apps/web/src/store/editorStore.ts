import { create } from 'zustand'
import type { AISuggestion } from '@platform/types'

type AIState = 'idle' | 'loading' | 'suggestion' | 'refining'

interface EditorStore {
  content: Record<string, string>
  isDirty: boolean
  lastSavedAt: string | null
  aiSuggestion: AISuggestion | null
  aiState: AIState
  traceabilityTarget: string | null
  updateContent: (sectionId: string, html: string) => void
  setAIState: (state: AIState) => void
  setAISuggestion: (suggestion: AISuggestion | null) => void
  acceptAISuggestion: () => void
  rejectAISuggestion: () => void
  setTraceabilityTarget: (value: string | null) => void
  markSaved: () => void
}

export const useEditorStore = create<EditorStore>(set => ({
  content: {},
  isDirty: false,
  lastSavedAt: null,
  aiSuggestion: null,
  aiState: 'idle',
  traceabilityTarget: null,
  updateContent: (sectionId, html) =>
    set(s => ({ content: { ...s.content, [sectionId]: html }, isDirty: true })),
  setAIState: (aiState) => set({ aiState }),
  setAISuggestion: (aiSuggestion) => set({ aiSuggestion }),
  acceptAISuggestion: () => set({ aiSuggestion: null, aiState: 'idle', isDirty: true }),
  rejectAISuggestion: () => set({ aiSuggestion: null, aiState: 'idle' }),
  setTraceabilityTarget: (traceabilityTarget) => set({ traceabilityTarget }),
  markSaved: () => set({ isDirty: false, lastSavedAt: new Date().toISOString() }),
}))
