// Module C content item 6-stage machine.
//
// Stages are numeric 1..6 (per data model §28.1). Named mapping lives here
// in TS so routes don't scatter magic numbers.
//
//   1 — Briefing          (compliance_track selected but not yet locked)
//   2 — Drafting          (compliance_track LOCKED from here — DD-C-001)
//   3 — Internal review   (FK score + claims matrix complete)
//   4 — MLR submission    (patient-facing items need fk_passed to advance)
//   5 — MLR review        (reviewer edits + comments)
//   6 — Approved / Final  (expiry_date set from approved_at + 24 months)
//
// Advancement is strictly linear; MLR Lead can bounce back by one stage via
// the generic /transition route (handled by the route layer, not here).

export type ContentStage = 1 | 2 | 3 | 4 | 5 | 6
export const CONTENT_STAGES: ContentStage[] = [1, 2, 3, 4, 5, 6]

export const STAGE_LABELS: Record<ContentStage, string> = {
  1: 'briefing',
  2: 'drafting',
  3: 'internal_review',
  4: 'mlr_submission',
  5: 'mlr_review',
  6: 'approved',
}

export function nextContentStage(from: ContentStage): ContentStage | null {
  if (from === 6) return null
  return (from + 1) as ContentStage
}

/** True when the compliance_track is locked (stage 2 onward per DD-C-001). */
export function complianceTrackIsLocked(stage: ContentStage): boolean {
  return stage >= 2
}

export class StageAdvanceBlockedError extends Error {
  constructor(message: string, public readonly reason: 'terminal' | 'fk_fail' | 'invalid') {
    super(message)
    this.name = 'StageAdvanceBlockedError'
  }
}
