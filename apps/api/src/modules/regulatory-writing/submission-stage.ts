// Regulatory submission 6-stage machine.
//
//   1 — Source gathering       (Module A docs linked, canonical JSON seeded)
//   2 — Module 2 authoring     (Module 2.5 + 2.7 narratives drafted)
//   3 — Finalisation           (consistency check green, CMC ack'd)
//   4 — Super Review           (final e-sig chain prep)
//   5 — Publishing             (eCTD validator green; redactions LOCKED)
//   6 — Submitted              (gateway transmit — terminal for this record)
//
// Stage 6 is terminal; a 'post_submission' status covers the follow-up
// state but doesn't re-enter the stage number. Backwards transitions are
// bounceable until stage 5 — after stage 5 redactions are immutable
// (DD-D-003) and bouncing back would require explicit audit.

export type SubmissionStage = 1 | 2 | 3 | 4 | 5 | 6
export const SUBMISSION_STAGES: SubmissionStage[] = [1, 2, 3, 4, 5, 6]

export const STAGE_LABELS: Record<SubmissionStage, string> = {
  1: 'source_gathering',
  2: 'module2_authoring',
  3: 'finalisation',
  4: 'super_review',
  5: 'publishing',
  6: 'submitted',
}

export function nextSubmissionStage(from: SubmissionStage): SubmissionStage | null {
  if (from === 6) return null
  return (from + 1) as SubmissionStage
}

/** Redactions are LOCKED once a submission reaches stage 5+ per DD-D-003. */
export function redactionsLocked(stage: SubmissionStage): boolean {
  return stage >= 5
}

export class StageAdvanceBlockedError extends Error {
  constructor(
    message: string,
    public readonly reason: 'terminal' | 'consistency_fail' | 'cmc_not_ack' | 'validation_fail',
  ) {
    super(message)
    this.name = 'StageAdvanceBlockedError'
  }
}
