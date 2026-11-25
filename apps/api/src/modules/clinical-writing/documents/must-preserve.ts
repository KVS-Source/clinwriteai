// Must-preserve manifest extractor (migration 104, Package 3).
//
// Deterministic (no AI) extraction of the artefacts that MUST survive an
// AI section rewrite:
//
//   - citation markers:   [1], [Smith 2023], [cite:p<uuid>], [Ref-N], (Smith et al., 2023)
//   - cross-references:   §4.2.1, Section 4.2, Table 3, Figure 2, Appendix A
//   - numeric values:     25 mg/kg, n=120, p<0.05, 95% CI, ±1.4
//   - study identifiers:  NCT00000000, EudraCT 2026-000001-00, protocol #, drug codes
//   - acronyms:            2–6 uppercase chars defined earlier in the doc
//
// Why deterministic: this is the firewall against AI hallucination. If
// the detector itself calls an AI it becomes another drift surface. All
// regex, all pure, fully unit-testable.
//
// Coverage target: ~95% of real-world markers. Edge cases (figure call-
// outs split across paragraphs, non-standard bracket styles) tracked
// in the per-call step log so we can tune the rubric from real data.
//
// Consumed by:
//   - documents/service.ts (Package 6) at doc-create to seed SectionContent.mustPreserveManifest
//   - the save-section path to refresh the manifest on body change
//   - ai-suggest-retry.ts (Package 7) to diff before/after and raise flags

/* eslint-disable security/detect-non-literal-regexp */

export interface NumberEntry {
  raw:     string                // "25 mg/kg", "n=120"
  context: string                // ≤ 40 chars of surrounding text — helps diff see the number in context
}

export interface MustPreserveManifest {
  citationMarkers: string[]
  crossRefs:       string[]
  numbers:         NumberEntry[]
  studyIds:        string[]
  acronyms:        string[]
}

export const EMPTY_MANIFEST: Readonly<MustPreserveManifest> = Object.freeze({
  citationMarkers: [],
  crossRefs:       [],
  numbers:         [],
  studyIds:        [],
  acronyms:        [],
})

// ────────────────────────────────────────────────────────────────────────
// Regex library.
//
// Order matters where patterns overlap: citations run before cross-refs
// so "[Table 3, Smith 2023]" is captured as a citation first.

const CITATION_PATTERNS: readonly RegExp[] = [
  /\[cite:[a-zA-Z0-9_-]+\]/g,                                // [cite:p<uuid>] inline-assistant style
  /\[Ref-[A-Za-z0-9]+\]/g,                                   // [Ref-12], [Ref-ABC]
  /\[[A-Z][a-zA-Z]+(?: et al\.?)?,? ?\d{4}[a-z]?\]/g,        // [Smith 2023], [Smith et al., 2023a]
  /\([A-Z][a-zA-Z]+(?: et al\.?)?,? ?\d{4}[a-z]?\)/g,        // (Smith 2023), (Smith et al., 2023)
  /\[\d{1,3}(?:[,–—-]\s*\d{1,3})*\]/g,             // [1], [1-3], [1,2,5], [1–3]
]

const CROSS_REF_PATTERNS: readonly RegExp[] = [
  /§\s?\d+(?:\.\d+)*[a-z]?/g,                                // §4, §4.2, §4.2.1, §4.2a
  /\bSection\s+\d+(?:\.\d+)*[a-z]?/g,                        // Section 4.2.1
  /\b(?:Table|Figure|Appendix|Annex|Exhibit|Fig\.?)\s+[A-Z0-9]+(?:[.-][A-Z0-9]+)*/g, // Table 3, Figure 2.1, Appendix A, Fig. 1-2
  /\b(?:Attachment|Supplement|Addendum)\s+[A-Z0-9]+/g,
]

// Numbers deliberately strict — only captures values that carry a unit,
// percentage, ratio, or statistical qualifier. A bare "5" in prose isn't
// a preserve-worthy data point and would flood the manifest.
//
// Alternative order matters: more specific patterns MUST come first,
// otherwise the generic percent-unit branch eats "95%" before the
// "95% CI" branch can see it.
const NUMBER_RE =
  /\b95%\s?CI\b|\b(?:p|P|r|R|n|N|OR|HR|RR|CI)\s*[=<>≤≥]\s*\d+(?:[.,]\d+)?(?:\s*%)?|(?<!\w)[-−]?\d+(?:[.,]\d+)?\s*(?:%|mg\/kg|mg\/m²|µg\/kg|mg|µg|g\b|kg\b|mL\b|L\b|mmol\b|mol\b|IU\b|U\b|units?|ng\/mL|µmol\/L|mmHg|kPa|°C|hours?|hr\b|h\b|min\b|days?|weeks?|months?|years?)|±\s?\d+(?:[.,]\d+)?/g

// Common clinical / regulatory identifier formats. Order matters — the
// more specific patterns run first to avoid them being eaten by the
// generic protocol-ID catch-all.
const STUDY_ID_PATTERNS: readonly RegExp[] = [
  /\bNCT\d{8}\b/g,                                           // NCT00000000
  /\bEudraCT\s+\d{4}-\d{6}-\d{2}\b/g,                        // EudraCT 2026-000001-00
  /\bEUDAMED\s+[A-Z0-9-]+/gi,
  /\bIND\s+\d+\b/g,                                          // IND 12345
  /\bCTIS\s+\d+\b/g,
  /\b(?:ISRCTN|ChiCTR|UMIN|CTRI)\s?\d+\b/g,
  /\b(?:Protocol|Study)\s+(?:No\.?|Number|ID|#)\s?[A-Z0-9][A-Z0-9-]*\b/gi,
]

// Acronyms: a 2–6 uppercase-letter token that was DEFINED earlier in the
// text. Two conventions are both common in clinical writing:
//
//   (a) "AE (Adverse Event)"       — acronym first, expansion in parens
//   (b) "Adverse Event (AE)"       — expansion first, acronym in parens
//
// Both patterns feed the same "defined set"; any acronym used later in
// the body that isn't in the set (and isn't on the common allowlist) is
// a candidate undefined-acronym flag in Package 4's soft validator.
const ACRONYM_DEFINED_FORWARD_RE  = /\b([A-Z][A-Z0-9]{1,5})\b\s*\(([^)]{3,80})\)/g
const ACRONYM_DEFINED_BACKWARD_RE = /\b([A-Za-z][A-Za-z\s-]{3,60})\s*\(([A-Z][A-Z0-9]{1,5})\)/g
const ACRONYM_USAGE_RE            = /\b([A-Z][A-Z0-9]{1,5})\b/g

// Super-common words that LOOK like acronyms but aren't (US, UK, EU,
// FDA, EMA, MHRA). Keeping the set tiny on purpose — the goal is to
// suppress false-positive "undefined acronym" flags, not to maintain
// a dictionary.
const ACRONYM_COMMON_ALLOWLIST: ReadonlySet<string> = new Set([
  'US', 'UK', 'EU', 'USA', 'FDA', 'EMA', 'MHRA', 'WHO', 'ICH', 'GCP', 'GMP',
  'PDF', 'HTML', 'URL', 'ID', 'IP', 'OK', 'NA', 'NI', 'NR', 'NS', 'NE',
  'AM', 'PM', 'ET', 'GMT', 'UTC',
])

// ────────────────────────────────────────────────────────────────────────
// HTML → plain-text (deterministic, no library).
// We don't need DOM fidelity — we need every text node joined with
// whitespace so regex matches don't skip across tag boundaries.

function htmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/(li|h[1-6]|tr|td|th|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
}

// ────────────────────────────────────────────────────────────────────────
// Extractors (pure).

function uniq<T>(xs: Iterable<T>): T[] { return [...new Set(xs)] }

function matchAll(text: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = []
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[0].trim())
  }
  return uniq(out)
}

function extractNumbers(text: string, contextRadius = 40): NumberEntry[] {
  const out: NumberEntry[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0].trim()
    const idx = m.index ?? 0
    const start = Math.max(0, idx - contextRadius)
    const end   = Math.min(text.length, idx + raw.length + contextRadius)
    const context = text.slice(start, end).replace(/\s+/g, ' ').trim()
    // Dedup by (raw + first 12 chars of context) — same value in two
    // different spots is worth preserving twice.
    const key = `${raw}::${context.slice(0, 12)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw, context })
  }
  return out
}

function extractDefinedAcronyms(text: string): string[] {
  const out: string[] = []
  // "AE (Adverse Event)" — acronym is match[1]
  for (const m of text.matchAll(ACRONYM_DEFINED_FORWARD_RE)) out.push(m[1]!)
  // "Adverse Event (AE)" — acronym is match[2]
  for (const m of text.matchAll(ACRONYM_DEFINED_BACKWARD_RE)) out.push(m[2]!)
  return uniq(out)
}

/** Return every acronym-looking token used in the text, excluding ones
 *  on the common allowlist. Used to compute "undefined" set = used ∖ (defined ∪ allowlist). */
export function acronymsUsed(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(ACRONYM_USAGE_RE)) {
    const token = m[1]!
    if (!ACRONYM_COMMON_ALLOWLIST.has(token)) out.push(token)
  }
  return uniq(out)
}

/** Extract every must-preserve artefact from an HTML section body.
 *  Deterministic + idempotent — same input → same output. */
export function extractManifest(html: string): MustPreserveManifest {
  const text = htmlToText(html)
  return {
    citationMarkers: matchAll(text, CITATION_PATTERNS),
    crossRefs:       matchAll(text, CROSS_REF_PATTERNS),
    numbers:         extractNumbers(text),
    studyIds:        matchAll(text, STUDY_ID_PATTERNS),
    acronyms:        extractDefinedAcronyms(text),
  }
}

// ────────────────────────────────────────────────────────────────────────
// Prompt rendering.

/** Render the manifest as a human-readable "MUST PRESERVE" block for
 *  inclusion in the AI regenerate prompt. Empty manifest returns an
 *  empty string so callers can `if (block)` guard without special-case. */
export function renderForPrompt(m: MustPreserveManifest): string {
  const lines: string[] = []
  if (m.citationMarkers.length > 0) lines.push(`Citation markers: ${m.citationMarkers.join(', ')}`)
  if (m.crossRefs.length       > 0) lines.push(`Cross-references: ${m.crossRefs.join(', ')}`)
  if (m.studyIds.length        > 0) lines.push(`Study identifiers: ${m.studyIds.join(', ')}`)
  if (m.numbers.length         > 0) {
    const vals = m.numbers.slice(0, 40).map(n => n.raw)   // cap at 40 to keep token cost bounded
    lines.push(`Numeric values that must appear verbatim: ${vals.join(', ')}${m.numbers.length > 40 ? ` (+${m.numbers.length - 40} more)` : ''}`)
  }
  if (m.acronyms.length        > 0) lines.push(`Acronyms defined earlier in the document (use these forms, do not redefine): ${m.acronyms.join(', ')}`)
  if (lines.length === 0) return ''
  return [
    `MUST PRESERVE — these artefacts appear in the current section body and MUST survive the rewrite:`,
    ...lines.map(l => `- ${l}`),
    `Do NOT drop or alter these. Do NOT invent new citations — if you cannot ground a claim in the attached sources, omit the claim rather than making one up.`,
  ].join('\n')
}

// ────────────────────────────────────────────────────────────────────────
// Diff — called post-regenerate to detect drift.

export interface ManifestDiff {
  droppedCitations:     string[]   // citations in `before` absent from `after`
  droppedCrossRefs:     string[]
  droppedStudyIds:      string[]
  changedNumbers:       Array<{ was: string; context: string }>  // numeric value in `before` absent from `after`
  newUndefinedAcronyms: string[]   // acronyms in `after` neither defined earlier nor on the allowlist
  // Citations present in the rewrite that WERE NOT in the before set —
  // could be legitimate (newly grounded from attached sources) or
  // invented. Package 4's validateCitationGrounding checks against
  // actually attached source refs to split those cases.
  newCitations:         string[]
}

/** Diff the pre-regenerate manifest against the HTML the model returned.
 *  Pure — no IO. */
export function diff(before: MustPreserveManifest, afterHtml: string): ManifestDiff {
  const after = extractManifest(afterHtml)
  const afterText = htmlToText(afterHtml)

  const afterCitationSet = new Set(after.citationMarkers)
  const afterCrossRefSet = new Set(after.crossRefs)
  const afterStudyIdSet  = new Set(after.studyIds)

  const droppedCitations = before.citationMarkers.filter(c => !afterCitationSet.has(c))
  const droppedCrossRefs = before.crossRefs.filter(c => !afterCrossRefSet.has(c))
  const droppedStudyIds  = before.studyIds.filter(s => !afterStudyIdSet.has(s))

  const afterNumRaw = new Set(after.numbers.map(n => n.raw))
  const changedNumbers = before.numbers
    .filter(n => !afterNumRaw.has(n.raw))
    .map(n => ({ was: n.raw, context: n.context }))

  const beforeCitationSet = new Set(before.citationMarkers)
  const newCitations = after.citationMarkers.filter(c => !beforeCitationSet.has(c))

  // Undefined-acronym detection: look at every acronym USED in the
  // after-text and flag ones that were not defined earlier in the doc
  // and aren't on the common allowlist.
  const definedSet = new Set([...before.acronyms, ...after.acronyms])
  const usedAfter = acronymsUsed(afterText)
  const newUndefinedAcronyms = usedAfter.filter(a => !definedSet.has(a))

  return { droppedCitations, droppedCrossRefs, droppedStudyIds, changedNumbers, newUndefinedAcronyms, newCitations }
}
