import { create } from 'zustand'
import type { AISuggestion } from '@platform/types'

type AIState = 'idle' | 'loading' | 'suggestion' | 'refining'

export interface TextSpan { start: number; end: number }

interface EditorStore {
  content: Record<string, string>
  isDirty: boolean
  lastSavedAt: string | null
  aiSuggestion: AISuggestion | null
  aiState: AIState
  traceabilityTarget: string | null
  /** Where the selected text sits in the section (offsets into its whitespace-collapsed text) */
  traceabilityRange: TextSpan | null
  /** Where each of the section's references was found in the text, by reference id */
  linkedSpans: Record<string, TextSpan>
  /** Source open in the right-hand viewer (optionally at a page, with the cited text) */
  sourceViewer: { uploadId: string; page?: number | null; spanText?: string } | null
  updateContent: (sectionId: string, html: string) => void
  setAIState: (state: AIState) => void
  setAISuggestion: (suggestion: AISuggestion | null) => void
  acceptAISuggestion: () => void
  rejectAISuggestion: () => void
  setTraceabilityTarget: (value: string | null, range?: TextSpan | null) => void
  setLinkedSpans: (value: Record<string, TextSpan>) => void
  setSourceViewer: (value: EditorStore['sourceViewer']) => void
  markSaved: () => void
}

export const useEditorStore = create<EditorStore>(set => ({
  content: {},
  isDirty: false,
  lastSavedAt: null,
  aiSuggestion: null,
  aiState: 'idle',
  traceabilityTarget: null,
  traceabilityRange: null,
  linkedSpans: {},
  sourceViewer: null,
  updateContent: (sectionId, html) =>
    set(s => ({ content: { ...s.content, [sectionId]: html }, isDirty: true })),
  setAIState: (aiState) => set({ aiState }),
  setAISuggestion: (aiSuggestion) => set({ aiSuggestion }),
  acceptAISuggestion: () => set({ aiSuggestion: null, aiState: 'idle', isDirty: true }),
  rejectAISuggestion: () => set({ aiSuggestion: null, aiState: 'idle' }),
  setTraceabilityTarget: (traceabilityTarget, range) => set({ traceabilityTarget, traceabilityRange: traceabilityTarget ? range ?? null : null }),
  setLinkedSpans: (linkedSpans) => set({ linkedSpans }),
  setSourceViewer: (sourceViewer) => set({ sourceViewer }),
  markSaved: () => set({ isDirty: false, lastSavedAt: new Date().toISOString() }),
}))
