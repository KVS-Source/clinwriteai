// Flesch-Kincaid grade computation for patient-facing medical content.
//
// Used by the Medical ai-suggest route (Package C-5, migration 105) as
// a soft validator: if a rewrite of a patient-facing section (pil /
// eu_ctr_pls) pushes the FK grade above 8.0, append the
// `fk_score_raised` flag so the author sees the regression on the
// section's confidence badge.
//
// Formula (standard Flesch-Kincaid grade-level):
//   FK = 0.39 × (words / sentences) + 11.8 × (syllables / words) - 15.59
//
// Inlined rather than depending on an external npm module — the
// tokenisation heuristics are forgiving (medical content is messy) and
// the formula is 3 lines once you have the counts. Adding a dependency
// for 3 lines of arithmetic isn't worth the supply-chain footprint.

/** Set of content types where FK grade is a published-stage pre-flight
 *  gate (≤ 8.0 required to advance to MLR). The ai-suggest route uses
 *  this set to decide whether to compute + compare FK on the output. */
export const FK_GATED_TYPES: ReadonlySet<string> = new Set(['pil', 'eu_ctr_pls'])

/** Grade cutoff mirroring the pre-MLR gate (routes.ts in pre-mlr). */
export const FK_TARGET = 8.0

// Strip HTML to visible text — collapses whitespace, drops tags +
// common entities. Not a full DOM parse; good enough for FK counts.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// Count sentences by ., !, ?. Clamp to >= 1 so a single-clause body
// doesn't divide-by-zero.
function countSentences(text: string): number {
  const matches = text.match(/[.!?]+/g)
  return Math.max(1, matches?.length ?? 1)
}

// Split on whitespace. Punctuation stays attached to the word (fine
// for the syllable heuristic).
function countWords(text: string): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  return words
}

// Heuristic syllable count — tokenise on vowel-groups, subtract a
// trailing silent 'e', clamp at >= 1. Matches the standard "count
// vowel groups" approach used by most lightweight readability tools.
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length === 0) return 0
  if (w.length <= 3) return 1
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const vowelGroups = stripped.match(/[aeiouy]+/g) ?? []
  return Math.max(1, vowelGroups.length)
}

export interface FkGradeResult {
  grade:     number
  words:     number
  sentences: number
  syllables: number
}

/** Compute Flesch-Kincaid grade for an HTML block. Returns the grade
 *  (rounded to 1 decimal) + the input counts for audit traceability.
 *  Returns grade = 0 for empty input. */
export function computeFkGrade(html: string): FkGradeResult {
  const text = htmlToText(html)
  if (text.length === 0) return { grade: 0, words: 0, sentences: 0, syllables: 0 }
  const words = countWords(text)
  const wordCount = words.length
  if (wordCount === 0) return { grade: 0, words: 0, sentences: 0, syllables: 0 }
  const sentenceCount = countSentences(text)
  let syllableCount = 0
  for (const w of words) syllableCount += countSyllables(w)
  const grade = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59
  return {
    grade:     Math.round(grade * 10) / 10,
    words:     wordCount,
    sentences: sentenceCount,
    syllables: syllableCount,
  }
}

/** True if the content type is FK-gated (patient-facing). Thin wrapper
 *  so callers don't have to import the Set constant. */
export function isFkGatedType(type: string): boolean {
  return FK_GATED_TYPES.has(type)
}
