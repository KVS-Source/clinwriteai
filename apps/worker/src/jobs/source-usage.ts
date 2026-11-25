// Which attached sources a drafted section actually used.
//
// Every section call gets all the document's source PDFs, so "attached" says nothing about a section. The
// drafter is asked to open its answer with one hidden comment naming the numbered sources it used:
//
//   <!-- sources-used: 2, 5 -->      or      <!-- sources-used: none -->
//
// It comes first because a long section can hit the output limit, which would cut off a closing line. It is
// removed before the section is saved, and only numbers of sources that really were attached count.

const MARKER = /<!--\s*sources-used\s*:\s*([^>]*?)\s*-->/gi

/** The instruction added to the section prompt; null when nothing is attached (there is nothing to name). */
export function sourceUsageInstruction(attachedCount: number): string | null {
  if (attachedCount === 0) return null
  return [
    `Begin your answer with exactly one HTML comment naming, by number, the sources this section takes content from, for example <!-- sources-used: 1 --> .`,
    `First decide which sources you will use, then write the section using only those.`,
    `List a source only if a fact, figure, definition or wording in this section comes from it. Do not list a source merely because it is attached or related. If the section takes nothing from any source (for example it is all [TBD: ...] markers), write <!-- sources-used: none --> .`,
  ].join(' ')
}

/**
 * Takes the marker out of the model's answer. `used` holds zero-based indexes into the attached sources, in
 * order; null when the answer carries no readable marker, so the usage is unknown (not "none").
 */
export function extractSourceUsage(text: string, attachedCount: number): { html: string; used: number[] | null } {
  const values = [...text.matchAll(MARKER)].map(m => m[1]!.trim())
  const html = text.replace(MARKER, '').trim()
  if (values.length === 0) return { html, used: null }
  const numbers = values.flatMap(v => (v.match(/\d+/g) ?? []).map(Number))
  const used = [...new Set(numbers.filter(n => n >= 1 && n <= attachedCount).map(n => n - 1))].sort((a, b) => a - b)
  if (used.length > 0) return { html, used }
  // No valid number: only an explicit "none" means nothing was used.
  return { html, used: numbers.length === 0 && values.some(v => /^none\.?$/i.test(v)) ? [] : null }
}
