// How far an AI draft has got: how many of the document's sections the drafter has written into.
//
// Every section row exists from the moment the document is created (seeded from the template), so the row count
// is the total. The initial-draft worker sets `aiSpanCount` to 1 when it commits a section (even a section it
// left with placeholders), so a section counts as drafted once that is above 0 — whether it was written in this
// run or an earlier one that was paused. A section a person typed into before the drafter reached it is skipped
// by the worker and isn't counted.

export interface DraftProgress {
  draftedSections: number
  totalSections:   number
}

export function draftProgress(rows: ReadonlyArray<{ aiSpanCount: number | null }>): DraftProgress {
  return {
    draftedSections: rows.filter(r => (r.aiSpanCount ?? 0) > 0).length,
    totalSections:   rows.length,
  }
}
