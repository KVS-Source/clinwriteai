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
  | 'cancelled'    // writer hit Stop on the toast; worker exits at next section boundary
  | 'not_configured' // legacy: no AI provider set up; replaced by 'blocked' with preflight issue
  | 'blocked'      // preflight found missing inputs (policy / checklist / sources / AI); AI Debug panel shows Blockers + Continue

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
  /** True when this deployment has no AI provider key and runs the placeholder drafter (dev/CI only). */
  aiStubMode?:        boolean
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
  // Verbose provenance dump for support + debugging — returns the policy
  // stack, template, sources (with worker-drop reasons), section state +
  // confidence, drafting passes, and the AI audit tail. The client
  // renders this as JSON with a Copy button.
  debug: (documentId: string) =>
    api.get<Record<string, unknown>>(`/documents/${encodeURIComponent(documentId)}/ai-debug`),
  // Stop an in-flight draft or validation chain. Flips the document's
  // aiDraftState to 'cancelled' so the worker bails at the next
  // section boundary. Safe to call while state is 'pending', 'drafting',
  // or 'validating'; no-op otherwise.
  stopDraft: (documentId: string) =>
    api.post<{ state: AiDraftState; cancelled: boolean }>(
      `/documents/${encodeURIComponent(documentId)}/ai-draft/stop`, {},
    ),
  // Preflight: reports structured blockers (missing policy / checklist /
  // sources / AI key). Drives the Blockers section + Continue button in
  // the AI Debug panel. Pure read, safe to call any time.
  preflight: (documentId: string) =>
    api.get<AiDraftPreflightResponse>(
      `/documents/${encodeURIComponent(documentId)}/ai-draft/preflight`,
    ),
  // Manual "Continue drafting" from the AI Debug panel. Runs preflight
  // server-side; 422 { issues } when still blocked, 200 { state: 'pending' }
  // once the job is enqueued, 409 when a draft is already in flight.
  startDraft: (documentId: string) =>
    api.post<{ state: AiDraftState; enqueued: boolean }>(
      `/documents/${encodeURIComponent(documentId)}/ai-draft/start`, {},
    ),
}

export type PreflightIssueCode =
  | 'ai_not_configured'
  | 'no_policy_for_doctype'
  | 'no_checklist'
  | 'no_sources'
  | 'all_sources_dropped'

export interface PreflightIssue {
  code:     PreflightIssueCode
  severity: 'block'
  message:  string
  fixPath?: string
}

export interface AiDraftPreflightResponse {
  ok:     boolean
  issues: PreflightIssue[]
}
