// AI drafting confidence rubric (2026-11-02).
//
// Deterministic — same flags in, same score out. GxP audit trail
// doesn't need to interrogate model behaviour; the rubric lives in
// code and is reviewable like any other business rule.
//
// Writes happen in apps/worker/src/jobs/ai-validation-pass.ts (the
// worker inlines the SAME constants + functions below so it stays
// a zero-dependency file; keep in sync). Reads happen here (API
// status endpoint) and in the shaper that returns per-section detail
// to the SPA.

/** Flag codes recorded on SectionContent.aiFlags during a validation pass.
 *  Any string not listed falls back to AI_UNKNOWN_WEIGHT when scoring. */
export const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  // Deterministic (completeness pass):
  'completeness:too_short': 40,

  // LLM self-critique (one of these per flagged section):
  'ai:self_critique':       30,
  'ai:template_mismatch':   20,
  'ai:coherence_issue':     20,

  // LLM cross-source consistency (one per unsupported claim):
  'ai:unsupported_claim':   30,
}

const AI_UNKNOWN_WEIGHT = 15

/** 0–100 score for a single section given its flag array. Empty = 100. */
export function scoreSection(flags: ReadonlyArray<string>): number {
  if (flags.length === 0) return 100
  let penalty = 0
  for (const f of flags) {
    penalty += FLAG_WEIGHTS[f] ?? AI_UNKNOWN_WEIGHT
  }
  return Math.max(0, Math.min(100, 100 - penalty))
}

/** 0–100 roll-up for a document given per-section scores (simple mean,
 *  rounded). An empty section set returns 0 — the UI reads this as
 *  "no sections drafted yet". */
export function overallConfidence(sectionScores: ReadonlyArray<number>): number {
  if (sectionScores.length === 0) return 0
  const sum = sectionScores.reduce((a, b) => a + b, 0)
  return Math.round(sum / sectionScores.length)
}

/** Confidence target the validator loop tries to hit before stopping
 *  early. Below this, the loop keeps running up to MAX_ITERATIONS. */
export const CONFIDENCE_TARGET = 85

/** Always run at least this many passes even if confidence hits target
 *  earlier. User direction 2026-11-02: "3 to 5 depending on error". */
export const MIN_ITERATIONS = 3

/** Hard cap. Beyond this the loop stops regardless of confidence —
 *  the UI then shows the still-flagged sections for human finishing. */
export const MAX_ITERATIONS = 5

/** The states Document.aiDraftState cycles through. Also the response
 *  union for GET /documents/:id/ai-draft-status.state. */
export type AiDraftState =
  | 'pending'      // enqueued; worker hasn't started yet
  | 'drafting'     // initial draft worker is running
  | 'validating'   // validation-pass loop is running
  | 'complete'     // loop ended cleanly (may have residual flags; see confidence)
  | 'failed'       // worker threw; writer should regenerate from the editor

/** Decide whether the validator loop should stop after this pass. */
export function shouldStopLoop(args: {
  iteration:        number
  confidenceOverall: number
  failingCount:     number
}): boolean {
  if (args.iteration >= MAX_ITERATIONS) return true
  if (args.failingCount === 0) return true
  if (args.iteration >= MIN_ITERATIONS && args.confidenceOverall >= CONFIDENCE_TARGET) {
    return true
  }
  return false
}
