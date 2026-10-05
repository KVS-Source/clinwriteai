// Content card overall-status derivation (Module E).
//
// The ideation card has two gates: a KOL review and an MA (Medical Affairs)
// review. The overall_status column is denormalised from those two for
// query performance, so every write path that touches kolStatus or maStatus
// must recompute via deriveOverallStatus().
//
// Rule (verbatim from the data model §45):
//   kol=approved AND ma=approved → approved
//   kol=approved AND ma=pending  → reviewed
//   kol=rejected OR  ma=rejected → rejected
//   kol=pending                  → under_review (if seen) OR uploaded (fresh)
//
// 'uploaded' is only the initial state. Once a card has been looked at by
// anyone (either reviewer transitions pending→approved→pending again, or
// MA moves without KOL), the first non-initial computation flips it to
// 'under_review'. The service layer passes `wasSeen` (true if either side
// has ever left pending) so this function stays pure.

export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type OverallCardStatus =
  | 'uploaded' | 'under_review' | 'reviewed' | 'approved' | 'rejected'

export function deriveOverallStatus(opts: {
  kolStatus: ReviewStatus
  maStatus: ReviewStatus
  /** True when at least one of (kol, ma) is non-pending OR has been in the past. */
  wasSeen: boolean
}): OverallCardStatus {
  // Terminal states take precedence — any rejection flips the whole card.
  if (opts.kolStatus === 'rejected' || opts.maStatus === 'rejected') return 'rejected'
  if (opts.kolStatus === 'approved' && opts.maStatus === 'approved') return 'approved'
  if (opts.kolStatus === 'approved' && opts.maStatus === 'pending') return 'reviewed'
  // kol is pending OR (kol pending && ma approved) — the card is in play.
  return opts.wasSeen ? 'under_review' : 'uploaded'
}
