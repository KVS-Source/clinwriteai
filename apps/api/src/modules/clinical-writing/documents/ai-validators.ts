// Deterministic post-generation validators (migration 104, Package 4).
//
// Called by the retry wrapper after every AI section-rewrite call.
// Consume the pre-regenerate must-preserve manifest + the AI's returned
// HTML + metadata about what the AI was allowed to cite, and produce a
// flat list of flag results.
//
// Severity split:
//   HARD — triggers a retry (max 1 retry in the wrapper):
//     dropped_cross_ref  : §x.y.z / Table N / Figure N / citation lost
//     invented_citation  : output contains a citation marker not present
//                          in the pre-call body AND not in attachedSourceIds
//
//   SOFT — flagged on the section but does NOT trigger retry:
//     number_drift       : a numeric value from the pre-call body is
//                          absent from the rewrite (most will be
//                          legitimate paraphrase — authors review)
//     undefined_acronym  : acronym used in the rewrite that was not
//                          defined earlier in the document and isn't
//                          on the common allowlist
//
// Pure, no IO — the retry wrapper calls these, collects flags, and (on
// hard flags) builds the feedback prompt for attempt 2.

import { diff, type MustPreserveManifest } from './must-preserve.js'

export type ValidatorCode =
  | 'dropped_cross_ref'
  | 'invented_citation'
  | 'number_drift'
  | 'undefined_acronym'

export type ValidatorSeverity = 'hard' | 'soft'

export interface ValidatorResult {
  code:     ValidatorCode
  severity: ValidatorSeverity
  details:  Record<string, unknown>
}

/** Map a validator flag to the corresponding ai-confidence FLAG_WEIGHTS
 *  code (Package 5 adds these to the registry). The ValidatorCode and
 *  the flag string are the same — kept as a const so consumers don't
 *  have to re-derive it. */
export const VALIDATOR_FLAG_CODE: Record<ValidatorCode, ValidatorCode> = {
  dropped_cross_ref: 'dropped_cross_ref',
  invented_citation: 'invented_citation',
  number_drift:      'number_drift',
  undefined_acronym: 'undefined_acronym',
}

// ────────────────────────────────────────────────────────────────────────
// Reference-preservation (HARD).
//
// A dropped cross-ref or dropped citation anchor is a hard fail — these
// are the artefacts the author explicitly wrote into the current body,
// and losing them silently is the highest-cost failure mode.

export function validateRefPreservation(
  before: MustPreserveManifest,
  afterHtml: string,
): ValidatorResult[] {
  const d = diff(before, afterHtml)
  const out: ValidatorResult[] = []
  if (d.droppedCitations.length > 0 || d.droppedCrossRefs.length > 0 || d.droppedStudyIds.length > 0) {
    out.push({
      code:     'dropped_cross_ref',
      severity: 'hard',
      details:  {
        citations: d.droppedCitations,
        crossRefs: d.droppedCrossRefs,
        studyIds:  d.droppedStudyIds,
      },
    })
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────
// Citation-grounding (HARD).
//
// Any NEW citation marker the AI introduced must be groundable in the
// attached source references. "Attached source refs" are the source
// library docs the AI had explicit permission to cite — i.e. the
// SourceReference rows wired into the ai-suggest route. Markers that
// reference ids/authors/etc. not in that set are "invented" and get a
// hard flag.

export interface AttachedSourceContext {
  /** Author surnames that appear in attached source metadata. Used to
   *  check "[Smith 2023]"-style citations. Case-insensitive match. */
  authorSurnames?: string[]
  /** Full set of allowed citation token strings — the CW route builds
   *  this from attached source metadata (e.g. "[cite:p<id>]", "[Ref-12]",
   *  "[1]" when the doc uses numbered refs). Matching is CASE-SENSITIVE
   *  and EXACT — if the rewrite introduces a citation not in this set
   *  AND not grounded by an authorSurname, flag it. */
  allowedTokens?: string[]
}

function looksLikeAuthorYearCitation(token: string): string | null {
  // Pull the surname out of "[Smith 2023]" / "(Smith et al., 2023)" / etc.
  const m = /[[(]\s*([A-Z][a-zA-Z]+)(?: et al\.?)?,? ?\d{4}/.exec(token)
  return m ? m[1]! : null
}

export function validateCitationGrounding(
  before: MustPreserveManifest,
  afterHtml: string,
  attached: AttachedSourceContext,
): ValidatorResult[] {
  const d = diff(before, afterHtml)
  if (d.newCitations.length === 0) return []
  const allowedTokenSet  = new Set(attached.allowedTokens ?? [])
  const allowedSurnameSet = new Set((attached.authorSurnames ?? []).map(s => s.toLowerCase()))
  const invented: string[] = []
  for (const token of d.newCitations) {
    if (allowedTokenSet.has(token)) continue
    const surname = looksLikeAuthorYearCitation(token)
    if (surname && allowedSurnameSet.has(surname.toLowerCase())) continue
    invented.push(token)
  }
  if (invented.length === 0) return []
  return [{
    code:     'invented_citation',
    severity: 'hard',
    details:  { citations: invented, allowedTokenCount: allowedTokenSet.size, allowedAuthorCount: allowedSurnameSet.size },
  }]
}

// ────────────────────────────────────────────────────────────────────────
// Numeric-preservation (SOFT).
//
// Dropped numbers may be legitimate paraphrase ("25 mg/kg was administered
// daily" → "a 25 mg/kg daily dose"). We flag for author review rather
// than retry — chasing paraphrase through retries spends tokens for
// little gain. Only suppresses on strict verbatim match in the output.

export function validateNumericPreservation(
  before: MustPreserveManifest,
  afterHtml: string,
): ValidatorResult[] {
  const d = diff(before, afterHtml)
  if (d.changedNumbers.length === 0) return []
  return [{
    code:     'number_drift',
    severity: 'soft',
    details:  { numbers: d.changedNumbers },
  }]
}

// ────────────────────────────────────────────────────────────────────────
// Acronym-consistency (SOFT).
//
// The rewrite introduces an acronym that was neither defined earlier in
// the document (in the pre-call manifest) nor on the common allowlist
// (FDA, EMA, US, …). Likely needs expansion on first use — author
// decides.

export function validateAcronymConsistency(
  before: MustPreserveManifest,
  afterHtml: string,
): ValidatorResult[] {
  const d = diff(before, afterHtml)
  if (d.newUndefinedAcronyms.length === 0) return []
  return [{
    code:     'undefined_acronym',
    severity: 'soft',
    details:  { acronyms: d.newUndefinedAcronyms },
  }]
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator: run every validator and return the flat combined list.
// Order: HARD first (so a caller looking for "any hard fail?" can scan
// the head of the array and short-circuit).

export function runAllValidators(args: {
  before:   MustPreserveManifest
  afterHtml: string
  attached: AttachedSourceContext
}): ValidatorResult[] {
  return [
    ...validateRefPreservation(args.before, args.afterHtml),
    ...validateCitationGrounding(args.before, args.afterHtml, args.attached),
    ...validateNumericPreservation(args.before, args.afterHtml),
    ...validateAcronymConsistency(args.before, args.afterHtml),
  ]
}

/** Any hard-severity result in the list? Convenience predicate used by
 *  the retry wrapper to decide whether to re-call the AI. */
export function hasHardFailure(results: readonly ValidatorResult[]): boolean {
  return results.some(r => r.severity === 'hard')
}

/** Build the structured feedback block the retry wrapper prepends to
 *  attempt 2's prompt when attempt 1 produced hard failures. Pure. */
export function renderRetryFeedback(results: readonly ValidatorResult[]): string {
  const lines: string[] = ['Your previous rewrite was rejected by automated checks. Produce a new rewrite that fixes ALL of the following:']
  for (const r of results) {
    if (r.severity !== 'hard') continue
    if (r.code === 'dropped_cross_ref') {
      const dropped = [
        ...(r.details.citations as string[] ?? []),
        ...(r.details.crossRefs as string[] ?? []),
        ...(r.details.studyIds  as string[] ?? []),
      ]
      lines.push(`- You dropped these references / cross-references / identifiers. Restore each one in context: ${dropped.join(', ')}.`)
    } else if (r.code === 'invented_citation') {
      const invented = r.details.citations as string[] ?? []
      lines.push(`- You introduced citation markers that are NOT grounded in the attached source references: ${invented.join(', ')}. Remove them or replace with a grounded citation.`)
    }
  }
  return lines.join('\n')
}
