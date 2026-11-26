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

  // Deterministic post-generation validators (migration 104, Package 5).
  // Fired by apps/api/src/modules/clinical-writing/documents/ai-validators.ts
  // after each section-rewrite call. Hard flags trigger the retry
  // wrapper (max 1 retry); soft flags surface to the author.
  // Hard:
  'dropped_cross_ref':      25,   // citation / cross-ref / study id lost from pre-call body
  'invented_citation':      35,   // new citation marker not grounded in attached sources
  // Soft:
  'number_drift':           20,   // numeric value from pre-call body absent from rewrite
  'undefined_acronym':      10,   // acronym used in rewrite neither defined nor on allowlist
  // Module C — Medical Writing (migration 105 Package C-5). Fired by
  // the Medical ai-suggest route AFTER the shared retry wrapper
  // returns, when the rewrite pushes the FK grade above 8.0 on a
  // patient-facing content type (pil / eu_ctr_pls). Soft — author
  // decides; doesn't trigger a retry because patient-facing
  // simplification is rarely a one-prompt fix.
  'fk_score_raised':        15,
  // Module C CME MCQ structural check (Package D-3). Fired on
  // cme_module content when the rewritten HTML looks like an
  // assessment-style section (contains question marks + lettered
  // options) but doesn't satisfy the MCQ contract (≥4 options per
  // question + exactly one correct marker per question). Soft.
  'mcq_structure_invalid':  15,
  // Module C expiry gate (Package D-4). Fired when the author
  // regenerates a section on a content item past its expiryDate.
  // Soft — a rewrite on expired content is unusual but not
  // forbidden; the flag signals it's time to re-approve before the
  // next MLR submission.
  'content_past_expiry':    10,
  // Module D HA response structural check (Package R-5). Fired on
  // ha_response_narrative content when the rewrite drops too many of
  // the conventional labels (Question / Response / Rationale /
  // Dossier Impact / References). Soft — HA responses are
  // heterogeneous and retry loops don't reliably converge.
  'ha_response_structure_invalid': 15,
  // Module D CTD structural cross-ref check (Package RD-2). Fired on
  // ctd_m2_* docTypes when the rewrite invents a §X.Y.Z or "Section
  // X.Y.Z" cross-ref that shares the document's CTD module top but
  // isn't on the ICH canonical subsection list for that module.
  // Soft — the full eCTD DTD validation is a vendor workstream; this
  // is a lightweight catch for the common "invented 2.5.9" drift.
  'ctd_invalid_cross_ref':         15,
  // Module E consent / disclosure check (Package E-5). Fired on
  // patient_story content when the rewrite drops every recognisable
  // Consent / Disclosures / COI label. Higher weight than other soft
  // flags — consent framing is an ethical / IRB / ICMJE obligation.
  'consent_disclosure_missing':    20,
  // Module E disclaimer check (Package E-5). Fired on
  // scientific_exchange_note + congress_summary when the rewrite drops
  // the non-promotional / sponsor-views boilerplate. Soft — wording
  // varies and legal/MLR teams own the exact phrasing.
  'disclaimer_missing':            15,
  // Module E press-release structure check (Package E-5). Fired on
  // press_release when fewer than 3 of 5 AP conventions (headline /
  // dateline / body / boilerplate / contact) survive the rewrite.
  // Soft — some channels drop elements legitimately (web-first,
  // internal draft).
  'press_release_structure_invalid': 10,
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
  | 'not_configured' // no AI provider is set up; sections left empty, nothing drafted

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
