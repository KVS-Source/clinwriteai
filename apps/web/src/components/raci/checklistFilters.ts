// Pure helpers for client-side filtering of checklist items.
//
// The GET /:documentId/checklist response returns every item regardless
// of ownerRaci. The ChecklistPanel can slice this list via these
// helpers so users with different roles see focused views without
// extra server round-trips.
//
// Shapes are deliberately loose (`ownerRaci: string`) so we can accept
// any ChecklistInstanceItem rendering shape without pulling the full
// Prisma type into the web bundle.

export interface ChecklistItemWithOwner {
  id: string
  ownerRaci: string
  status: 'pending' | 'complete' | 'waived'
  // Callers can add whatever other fields they need; filter helpers only
  // reach for `ownerRaci` + `status`.
}

/**
 * Filter to items owned by a specific RACI letter. Case-insensitive on
 * the letter so 'q', 'Q', 'qc' (first letter only) all route the same.
 */
export function filterByOwnerRaci<T extends ChecklistItemWithOwner>(
  items: T[],
  letter: string,
): T[] {
  const target = letter.charAt(0).toUpperCase()
  return items.filter(i => i.ownerRaci.toUpperCase() === target)
}

/**
 * Group every checklist item by ownerRaci letter. Letters with no
 * matching items are omitted — the caller renders only the sections
 * that have content.
 */
export function groupByOwnerRaci<T extends ChecklistItemWithOwner>(
  items: T[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) {
    const key = item.ownerRaci.toUpperCase()
    const bucket = out[key] ?? []
    bucket.push(item)
    out[key] = bucket
  }
  return out
}

/**
 * Count pending items per letter. Used by the ChecklistPanel header
 * to render "QC: 3 pending" chips alongside the submit gate preview.
 */
export function countPendingByOwnerRaci<T extends ChecklistItemWithOwner>(
  items: T[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    if (item.status !== 'pending') continue
    const key = item.ownerRaci.toUpperCase()
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
