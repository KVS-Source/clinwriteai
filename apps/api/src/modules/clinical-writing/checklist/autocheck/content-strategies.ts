// Content-presence autocheck strategies — pure functions over section
// content. Two strategies land in v1:
//
//   content-min-words:N[:sectionNumber]
//     Section N (or sum of all sections if omitted) has at least N words.
//
//   content-no-placeholders[:sectionNumber]
//     The section (or whole doc) contains no [TBD], [PLACEHOLDER], or
//     [REF] tokens. Case-insensitive on the token.
//
// Both strategies get the section content for the current version of the
// document from the engine; they never touch Prisma themselves. That
// keeps them trivial to test and side-effect-free.

export interface SectionContentForCheck {
  /** Section identifier — matches SourceReference.sectionId. */
  sectionId: string
  sectionNumber: string
  contentHtml: string
  wordCount: number
}

/**
 * References context passed to the references-complete strategy. Keyed
 * by section id (which matches SectionContentForCheck.sectionId). The
 * value is the count of ACTIVE references on that section — i.e. the
 * SourceReference rows that have no corresponding SourceReferenceRemoval.
 *
 * An empty record is semantically "nothing fetched yet" — strategies
 * that need the cross-check will skip rather than falsely passing.
 */
export type ReferencesContext = Record<string, number | undefined>

export function emptyReferencesContext(): ReferencesContext {
  return {}
}

/**
 * A section is considered to need at least one citation when it has
 * meaningful prose. Headers / stubs with little content aren't flagged.
 */
const SECTION_NEEDS_REFERENCE_THRESHOLD = 100

export type StrategyResult =
  | { kind: 'completed'; reason: string }
  | { kind: 'pending';   reason: string }
  | { kind: 'skipped';   reason: string }   // unknown strategy / malformed tag — do nothing

// ---------- Tag parsing ----------

interface ParsedTag {
  strategy: string
  args: string[]
}

export function parseAutoCompleteTag(tag: string | null | undefined): ParsedTag | null {
  if (!tag) return null
  const trimmed = tag.trim()
  if (trimmed.length === 0) return null
  const [strategy, ...args] = trimmed.split(':')
  if (!strategy) return null
  return { strategy: strategy.toLowerCase(), args }
}

// ---------- content-min-words ----------

export function evaluateContentMinWords(
  args: string[],
  sections: SectionContentForCheck[],
): StrategyResult {
  const minWords = Number(args[0])
  if (!Number.isFinite(minWords) || minWords <= 0) {
    return { kind: 'skipped', reason: `content-min-words: invalid threshold "${args[0]}"` }
  }

  const scopedSectionNumber = args[1]
  const scope = scopedSectionNumber
    ? sections.filter(s => s.sectionNumber === scopedSectionNumber)
    : sections

  if (scopedSectionNumber && scope.length === 0) {
    return { kind: 'skipped', reason: `content-min-words: section ${scopedSectionNumber} not found` }
  }

  const total = scope.reduce((n, s) => n + (s.wordCount || 0), 0)
  if (total >= minWords) {
    return { kind: 'completed', reason: `content-min-words: ${total}/${minWords} words` }
  }
  return { kind: 'pending', reason: `content-min-words: ${total}/${minWords} words (need ${minWords - total} more)` }
}

// ---------- content-no-placeholders ----------

const PLACEHOLDER_PATTERN = /\[(tbd|placeholder|ref)\]/i

export function evaluateContentNoPlaceholders(
  args: string[],
  sections: SectionContentForCheck[],
): StrategyResult {
  const scopedSectionNumber = args[0]
  const scope = scopedSectionNumber
    ? sections.filter(s => s.sectionNumber === scopedSectionNumber)
    : sections

  if (scopedSectionNumber && scope.length === 0) {
    return { kind: 'skipped', reason: `content-no-placeholders: section ${scopedSectionNumber} not found` }
  }

  // Walk every section; stop at first hit so the message is specific.
  for (const s of scope) {
    const match = s.contentHtml.match(PLACEHOLDER_PATTERN)
    if (match) {
      return {
        kind: 'pending',
        reason: `content-no-placeholders: ${match[0].toLowerCase()} still present in section ${s.sectionNumber}`,
      }
    }
  }
  return { kind: 'completed', reason: 'content-no-placeholders: clean' }
}

// ---------- references-complete ----------
//
// Pattern-based check for unresolved citation placeholders. Catches the
// common submission-blockers an R leaves behind during drafting:
//
//   [Ref: Smith 2020]        — AI-suggested cite the R hasn't resolved
//   [Ref: TBD]               — explicit placeholder
//   [cite], [cite: xxx]      — editor shorthand
//   [citation needed]        — Wikipedia-style flag
//   [reference needed]       — likewise
//
// Does NOT (yet) cross-check against the SourceReference table. The
// pattern catch gets us 80% of the value without the engine needing a
// second data source. A follow-up slice can extend the strategy signature
// to accept source references and verify every cited section has at
// least one active reference row.

const CITATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\[ref:\s*[^\]]*\]/i,       label: '[ref: …]'            },
  { pattern: /\[cite(?:\s|\]|:)[^\]]*\]?/i, label: '[cite …]'         },
  { pattern: /\[citation\s+needed\]/i,   label: '[citation needed]'   },
  { pattern: /\[reference\s+needed\]/i,  label: '[reference needed]'  },
]

export function evaluateReferencesComplete(
  args: string[],
  sections: SectionContentForCheck[],
  references: ReferencesContext = emptyReferencesContext(),
): StrategyResult {
  const scopedSectionNumber = args[0]
  const scope = scopedSectionNumber
    ? sections.filter(s => s.sectionNumber === scopedSectionNumber)
    : sections

  if (scopedSectionNumber && scope.length === 0) {
    return { kind: 'skipped', reason: `references-complete: section ${scopedSectionNumber} not found` }
  }

  // Pass 1 — pattern check (unresolved citation placeholders). This is
  // the historical v1 behaviour; still runs first because a specific
  // "[Ref: TBD]" message is more actionable than a generic "section has
  // no active references".
  for (const s of scope) {
    for (const { pattern, label } of CITATION_PATTERNS) {
      if (pattern.test(s.contentHtml)) {
        return {
          kind: 'pending',
          reason: `references-complete: ${label} still present in section ${s.sectionNumber}`,
        }
      }
    }
  }

  // Pass 2 — cross-check against SourceReference rows. For every scoped
  // section with substantive content (wordCount >= threshold), there must
  // be at least one active SourceReference. Below the threshold the
  // section is treated as a header / stub and no citation is required.
  //
  // If the caller passed an empty references context (nothing fetched),
  // this pass is skipped — we don't falsely fail a section just because
  // the context wasn't loaded. The engine's caller is responsible for
  // deciding when to fetch (same pattern as SignalContext).
  const hasReferencesContext = Object.keys(references).length > 0
  if (hasReferencesContext) {
    for (const s of scope) {
      if (s.wordCount < SECTION_NEEDS_REFERENCE_THRESHOLD) continue
      const count = references[s.sectionId] ?? 0
      if (count === 0) {
        return {
          kind: 'pending',
          reason: `references-complete: section ${s.sectionNumber} has ${s.wordCount} words of content but no active SourceReference rows`,
        }
      }
    }
  }

  return { kind: 'completed', reason: 'references-complete: no unresolved citation placeholders' + (hasReferencesContext ? ' and every substantive section has active references' : '') }
}
