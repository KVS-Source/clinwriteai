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

export type RaciLetter = 'R' | 'A' | 'C' | 'I'

export interface RaciRowForEval {
  letter: RaciLetter
  signatureRequired: boolean
  submittedAt: Date | null
  reviewedAt: Date | null
  approvedAt: Date | null
  signatureId: string | null
  rejectedAt: Date | null
  removedAt: Date | null
}

export interface TransitionEvaluation {
  // Current gating letter for the next transition from `from`. Null for
  // terminal states or states that aren't RACI-gated.
  gatingLetter: RaciLetter | null
  // Candidate next status if the cohort is complete. Null for terminal states.
  nextStatus: DocumentStatus | null
  // "Of the active rows holding gatingLetter, how many have finished?"
  cohortDone: number
  cohortTotal: number
  // True when cohortDone === cohortTotal AND cohortTotal > 0.
  // A stage with zero gating rows is NOT auto-ready — the PM must assign at
  // least one person before the transition is meaningful.
  cohortComplete: boolean
  // Any rows in the gating cohort that have rejected. Non-empty means the
  // doc should bounce back rather than progress.
  rejectedRows: number
}

interface GateDef {
  gatingLetter: RaciLetter | null
  nextStatus: DocumentStatus | null
}

const GATES: Record<DocumentStatus, GateDef> = {
  not_started:       { gatingLetter: 'R', nextStatus: 'in_authoring' },
  in_authoring:      { gatingLetter: 'R', nextStatus: 'in_review' },
  in_review:         { gatingLetter: 'C', nextStatus: 'pending_signature' },
  crm_in_progress:   { gatingLetter: 'C', nextStatus: 'pending_signature' },
  pending_signature: { gatingLetter: 'A', nextStatus: 'signed' },
  signed:            { gatingLetter: null, nextStatus: null },
}

function completionTimestampFor(letter: RaciLetter, row: RaciRowForEval): Date | null {
  switch (letter) {
    case 'R': return row.submittedAt
    case 'C': return row.reviewedAt
    case 'A': return row.approvedAt
    case 'I': return null
  }
}

export function evaluateStageTransition(
  from: DocumentStatus,
  rows: RaciRowForEval[],
): TransitionEvaluation {
  const gate = GATES[from] ?? { gatingLetter: null, nextStatus: null }
  if (!gate.gatingLetter) {
    return {
      gatingLetter: null,
      nextStatus: null,
      cohortDone: 0,
      cohortTotal: 0,
      cohortComplete: false,
      rejectedRows: 0,
    }
  }

  // Active rows holding the gating letter.
  const cohort = rows.filter(
    r => r.letter === gate.gatingLetter && r.removedAt === null,
  )

  const rejectedRows = cohort.filter(r => r.rejectedAt !== null).length

  const doneRows = cohort.filter(r => {
    const completed = completionTimestampFor(gate.gatingLetter!, r) !== null
    if (!completed) return false
    if (r.signatureRequired && !r.signatureId) return false
    return true
  })

  const cohortTotal = cohort.length
  const cohortDone = doneRows.length
  const cohortComplete = cohortTotal > 0 && cohortDone === cohortTotal && rejectedRows === 0

  return {
    gatingLetter: gate.gatingLetter,
    nextStatus: gate.nextStatus,
    cohortDone,
    cohortTotal,
    cohortComplete,
    rejectedRows,
  }
}
