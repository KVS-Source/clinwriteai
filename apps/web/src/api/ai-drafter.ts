// Client bindings for the AI drafter status surface (AI-1 backend).
//
// The SPA polls aiDrafterApi.status(docId) while a doc's draft/validate
// chain is in flight; the response feeds the AiConfidenceChip (document
// header), AiSectionConfidenceBadge (section navigator), and
// AiDraftingProgressToast (floating).

import { api } from './client'

export type AiDraftState =
  | 'pending'      // enqueued; worker hasn't started yet
  | 'drafting'     // initial draft worker is running
  | 'validating'   // validation-pass loop is running
  | 'complete'     // loop ended cleanly (may have residual flags; see confidence)
  | 'failed'       // worker threw; writer should regenerate from the editor
  | 'not_configured' // no AI provider set up; nothing was drafted, sections left empty

export interface AiDraftSectionStatus {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  /** 0-100; null until the first validation pass evaluates this section. */
  confidence:    number | null
  /** Flag codes written by the pass; empty = clean. */
  flags:         string[]
}

export interface AiDraftingPassSummary {
  passNumber:       number
  startedAt:        string
  finishedAt:       string | null
  sectionsFlagged:  number
  confidenceAfter:  number | null
  modelUsed:        string | null
  flagsJson:        unknown           // snapshot — rendered by Report panel
}

export interface AiDraftStatusResponse {
  /** null when the doc was never AI-drafted (e.g. created without the opt-in). */
  state:              AiDraftState | null
  /** 0-100 roll-up; null until the first pass runs. */
  confidenceOverall:  number | null
  lastPassNumber:     number | null
  lastPassAt:         string | null
  sections:           AiDraftSectionStatus[]
  passes:             AiDraftingPassSummary[]
}

export const aiDrafterApi = {
  status: (documentId: string) =>
    api.get<AiDraftStatusResponse>(`/documents/${encodeURIComponent(documentId)}/ai-draft-status`),
}
