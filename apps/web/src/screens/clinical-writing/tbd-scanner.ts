// Scans a document's section HTML for "[TBD: ...]" placeholders.
//
// Placeholders are inserted by the AI drafter whenever the attached sources
// don't contain the fact a section needs ("[TBD: protocol number]",
// "[TBD: sponsor name]", etc. — see policy-prompt.ts SECTION_GROUNDING_RULES).
// The TBD panel groups them by exact placeholder so the writer can jump to
// each instance + batch-replace a repeated one in a single server call.
//
// Scanner runs over the raw HTML string (not the live DOM) — matches inside
// inline formatting (<strong>[TBD: x]</strong>) are preserved because the
// pattern only looks at text between brackets. Case-insensitive on "TBD" so
// legacy "[Tbd: ...]" or "[tbd: ...]" also surface.

import type { Section } from '@platform/types'

const TBD_RE = /\[tbd:\s*([^\]]+?)\s*\]/gi

export interface TbdOccurrence {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  count:         number
}

export interface TbdGroup {
  /** The exact placeholder string including brackets — "[TBD: protocol number]".
   *  Case is normalised to the first occurrence seen (so the UI shows the
   *  casing the writer actually typed, not a lowercase-canonical form). */
  placeholder: string
  /** The message between the brackets, trimmed — "protocol number". Shown as
   *  the row label; the writer rarely wants to read "[TBD:" prefix 12 times. */
  message:     string
  occurrences: TbdOccurrence[]
  totalCount:  number
}

export function scanDocumentForTbds(sections: Section[]): TbdGroup[] {
  const groupsByKey = new Map<string, { placeholder: string; message: string; occurrences: TbdOccurrence[]; totalCount: number }>()

  for (const section of sections) {
    const html = section.contentHtml || ''
    if (!html) continue

    const perSection = new Map<string, { placeholder: string; message: string; count: number }>()
    TBD_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TBD_RE.exec(html)) !== null) {
      const placeholder = m[0]!
      const message     = m[1]!.trim()
      if (!message) continue
      const key = `tbd:${message.toLowerCase()}`
      const existing = perSection.get(key)
      if (existing) {
        existing.count += 1
      } else {
        perSection.set(key, { placeholder, message, count: 1 })
      }
    }

    for (const [key, hit] of perSection.entries()) {
      const group = groupsByKey.get(key)
      if (group) {
        group.occurrences.push({
          sectionId:     section.id,
          sectionNumber: section.number,
          sectionTitle:  section.title,
          count:         hit.count,
        })
        group.totalCount += hit.count
      } else {
        groupsByKey.set(key, {
          placeholder: hit.placeholder,
          message:     hit.message,
          totalCount:  hit.count,
          occurrences: [{
            sectionId:     section.id,
            sectionNumber: section.number,
            sectionTitle:  section.title,
            count:         hit.count,
          }],
        })
      }
    }
  }

  // Sort groups by total occurrences (most-wanted first — fastest to resolve
  // a shared placeholder across many sections), then alphabetically by message
  // for stable ordering when counts tie.
  return Array.from(groupsByKey.values())
    .map(g => ({ ...g, occurrences: sortOccurrences(g.occurrences) }))
    .sort((a, b) => b.totalCount - a.totalCount || a.message.localeCompare(b.message))
}

function sortOccurrences(list: TbdOccurrence[]): TbdOccurrence[] {
  return [...list].sort((a, b) => compareSectionNumbers(a.sectionNumber, b.sectionNumber))
}

/** Numeric-aware section-number compare — "2.10" > "2.9" even though strcmp
 *  says otherwise. Matches how the Sections list orders rows. */
function compareSectionNumbers(a: string, b: string): number {
  const partsA = a.split('.').map(p => parseInt(p, 10))
  const partsB = b.split('.').map(p => parseInt(p, 10))
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(partsA[i]) ? partsA[i]! : 0
    const bi = Number.isFinite(partsB[i]) ? partsB[i]! : 0
    if (ai !== bi) return ai - bi
  }
  return a.localeCompare(b)
}

export function countAllTbds(groups: TbdGroup[]): number {
  return groups.reduce((n, g) => n + g.totalCount, 0)
}
