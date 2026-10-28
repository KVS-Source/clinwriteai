// Stage transition evaluator — pure function. Given the current document
// status + its DocumentRaci rows, decides whether the cohort gating the
// next stage has finished (every non-removed row of the gating letter
// has its completion timestamp AND, if signature_required, a signature_id).
//
// This is the "all-done" rule from docs/roles-and-permissions.md §3.2 —
// a stage flips only when EVERY person in the gating cohort finishes.
//
// Mapping to the existing document_status state machine
// (apps/api/src/modules/clinical-writing/document-status.ts):
//
//   from              gating letter   to (when cohort complete)
//   -----             -------------   ------------------------
//   not_started       R               in_authoring (any R becomes active)
//   in_authoring      R               in_review
//   in_review         C               pending_signature (CRM flow may route via crm_in_progress separately)
//   crm_in_progress   C               pending_signature
//   pending_signature A               signed
//   signed            —               terminal
//
// The evaluator does not perform the DB write. Routes read its decision
// and apply the existing canTransitionDocument() check before mutating
// Document.status — so the status-machine invariant is preserved.

import type { DocumentStatus } from '../../clinical-writing/document-status.js'

export type RaciLetter = 'R' | 'A' | 'C' | 'I' | 'Q'

export interface RaciRowForEval {
  letter: RaciLetter
  signatureRequired: boolean
  submittedAt: Date | null
  reviewedAt: Date | null             // used by both C and Q (letter disambiguates)
  approvedAt: Date | null
  signatureId: string | null
  rejectedAt: Date | null
  removedAt: Date | null
}

export interface TransitionEvaluation {
  // Gating letter(s) for the next transition from `from`. Empty array for
  // terminal states; multiple letters when a stage is gated by more than
  // one cohort (e.g. in_review requires both C and Q to finish).
  gatingLetters: RaciLetter[]
  // Candidate next status if every gating cohort is complete. Null for
  // terminal states.
  nextStatus: DocumentStatus | null
  // "Of the active rows holding any gating letter, how many have finished?"
  cohortDone: number
  cohortTotal: number
  // True when cohortDone === cohortTotal AND cohortTotal > 0. A stage with
  // zero gating rows is NOT auto-ready — the owner must assign at least
  // one person before the transition is meaningful.
  cohortComplete: boolean
  // Rows in the gating cohort that have rejected. Non-empty means the doc
  // should bounce back rather than progress.
  rejectedRows: number
  // Legacy single-letter alias for consumers that haven't migrated to the
  // multi-letter shape yet. Set to the FIRST gating letter (or null when
  // terminal). Removed in a later pass.
  gatingLetter: RaciLetter | null
}

interface GateDef {
  gatingLetters: RaciLetter[]
  nextStatus: DocumentStatus | null
}

// C and Q share a gate: scientific review + QC release both complete
// before the doc moves to approval. Per docs/roles-and-permissions.md §4.
const GATES: Record<DocumentStatus, GateDef> = {
  not_started:       { gatingLetters: ['R'],      nextStatus: 'in_authoring' },
  in_authoring:      { gatingLetters: ['R'],      nextStatus: 'in_review' },
  in_review:         { gatingLetters: ['C', 'Q'], nextStatus: 'pending_signature' },
  crm_in_progress:   { gatingLetters: ['C', 'Q'], nextStatus: 'pending_signature' },
  pending_signature: { gatingLetters: ['A'],      nextStatus: 'signed' },
  signed:            { gatingLetters: [],         nextStatus: null },
}

function completionTimestampFor(letter: RaciLetter, row: RaciRowForEval): Date | null {
  switch (letter) {
    case 'R': return row.submittedAt
    case 'C': return row.reviewedAt
    case 'Q': return row.reviewedAt
    case 'A': return row.approvedAt
    case 'I': return null
  }
}

export function evaluateStageTransition(
  from: DocumentStatus,
  rows: RaciRowForEval[],
): TransitionEvaluation {
  const gate = GATES[from] ?? { gatingLetters: [], nextStatus: null }
  if (gate.gatingLetters.length === 0) {
    return {
      gatingLetters: [],
      gatingLetter: null,
      nextStatus: null,
      cohortDone: 0,
      cohortTotal: 0,
      cohortComplete: false,
      rejectedRows: 0,
    }
  }

  const gatingLetterSet = new Set<RaciLetter>(gate.gatingLetters)

  // Active rows holding any gating letter — this is the full cohort for
  // the stage, union across every gating letter.
  const cohort = rows.filter(r => gatingLetterSet.has(r.letter) && r.removedAt === null)

  const rejectedRows = cohort.filter(r => r.rejectedAt !== null).length

  const doneRows = cohort.filter(r => {
    const completed = completionTimestampFor(r.letter, r) !== null
    if (!completed) return false
    if (r.signatureRequired && !r.signatureId) return false
    return true
  })

  const cohortTotal = cohort.length
  const cohortDone = doneRows.length
  const cohortComplete = cohortTotal > 0 && cohortDone === cohortTotal && rejectedRows === 0

  return {
    gatingLetters: gate.gatingLetters,
    gatingLetter: gate.gatingLetters[0] ?? null,
    nextStatus: gate.nextStatus,
    cohortDone,
    cohortTotal,
    cohortComplete,
    rejectedRows,
  }
}
