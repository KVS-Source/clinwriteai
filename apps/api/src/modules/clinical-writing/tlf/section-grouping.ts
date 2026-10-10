// TLF per-item section grouping — pure helper.
//
// Extracted from tlf/routes.ts so the dedup + grouping logic (used
// by the doc-view endpoint to tell the UI which TLF items are cited
// on which sections) can be unit-tested without the Prisma query.

export interface SectionLinkLite {
  tlfItemId:  string
  sectionRef: string
}

/**
 * Group section references by TLF item id, preserving insertion order
 * and de-duplicating identical refs (a section citing an item twice
 * still appears once in the UI's linkedSections array).
 */
export function groupSectionsByItem(links: ReadonlyArray<SectionLinkLite>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of links) {
    const arr = out.get(l.tlfItemId) ?? []
    if (!arr.includes(l.sectionRef)) arr.push(l.sectionRef)
    out.set(l.tlfItemId, arr)
  }
  return out
}
