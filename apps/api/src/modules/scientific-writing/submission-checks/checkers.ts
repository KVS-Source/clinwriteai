// Real check implementations for a subset of the DEFAULT_CHECKS set.
//
// The submission-check "run" endpoint used to just bump lastRunAt on
// every row. This file provides pure checker functions for the labels
// we can evaluate against stored data today. Everything else continues
// to preserve its current state — writers who acknowledged a `warn`
// won't see it re-flip on re-run, and checks that need a real engine
// (format, EQUATOR, plagiarism, figures) stay as scaffolded rows.
//
// Keep checkers PURE — they read from inputs the caller fetched, never
// touch Prisma / fetch / clock. The service layer passes already-
// resolved data in; unit tests drive each checker from fixtures.
//
// To add a new real check:
//   1. Add a function here returning CheckResult
//   2. Add it to CHECKER_BY_LABEL below (exact DEFAULT_CHECKS.label match)
//   3. Add any new field it needs to CheckerInputs + fetch in the service
//
// The matching on exact label keeps the hook unambiguous. If
// DEFAULT_CHECKS wording changes, the map misses silently — a test
// asserts every key here matches a real DEFAULT_CHECKS label.

export type CheckState = 'pass' | 'warn' | 'block'

export interface CheckResult {
  state: CheckState
  /** Short note surfaced to the UI as the check's rationale.
   *  Empty string ⇒ no rationale (keeps the row clean when passing). */
  note:  string
}

export interface CheckerInputs {
  citations: ReadonlyArray<{
    pmid:              string | null
    fullRef:           string
    isSourceDocument:  boolean
  }>
  authors: ReadonlyArray<{
    id:          string
    name:        string
    isExternal:  boolean
    coiStatus:   string
  }>
}

// --- "All citations have DOIs" -----------------------------------------
//
// A DOI appears either as a "doi:" prefix in the fullRef or embedded
// inline as 10.NNNN/xxxx. Source-document citations (isSourceDocument)
// are skipped — those point at CSRs, not journal articles, and have
// no DOI. If a non-source citation lacks a DOI, we warn (not block):
// the author might still add the DOI later or the journal might not
// require it, but we want the writer to see the finding.
const DOI_PATTERN = /\b(doi:\s*10\.\d{4,9}\/\S+|10\.\d{4,9}\/\S+)\b/i

export function checkCitationsHaveDoi(inputs: CheckerInputs): CheckResult {
  const nonSource = inputs.citations.filter(c => !c.isSourceDocument)
  if (nonSource.length === 0) {
    return { state: 'pass', note: 'No non-source citations yet.' }
  }
  const missing = nonSource.filter(c => !DOI_PATTERN.test(c.fullRef))
  if (missing.length === 0) {
    return { state: 'pass', note: `All ${nonSource.length} citations have DOIs.` }
  }
  return {
    state: 'warn',
    note:  `${missing.length} of ${nonSource.length} citation(s) missing a DOI.`,
  }
}

// --- "Conflict of interest statement" ---------------------------------
//
// ICMJE requires every listed author (internal + external) to have
// submitted a COI statement before the manuscript can be submitted.
// Block the check when any current author has coiStatus != 'submitted'
// — this is a hard gate, unlike the DOI check. Removed authors (if we
// ever store them here) are excluded by the caller.
export function checkCoiStatements(inputs: CheckerInputs): CheckResult {
  if (inputs.authors.length === 0) {
    return { state: 'warn', note: 'No authors listed yet.' }
  }
  const outstanding = inputs.authors.filter(a => a.coiStatus !== 'submitted')
  if (outstanding.length === 0) {
    return {
      state: 'pass',
      note:  `All ${inputs.authors.length} author(s) submitted a COI statement.`,
    }
  }
  const names = outstanding.map(a => a.name).slice(0, 3).join(', ')
  const more  = outstanding.length > 3 ? ` + ${outstanding.length - 3} more` : ''
  return {
    state: 'block',
    note:  `${outstanding.length} author(s) have not submitted a COI statement: ${names}${more}.`,
  }
}

// --- label → checker ---------------------------------------------------

export const CHECKER_BY_LABEL: Record<string, (inputs: CheckerInputs) => CheckResult> = {
  'All citations have DOIs':        checkCitationsHaveDoi,
  'Conflict of interest statement': checkCoiStatements,
}

/** Exposed so the run endpoint can decide which rows are candidates
 *  for live evaluation vs. preserve-current-state. */
export function hasCheckerFor(label: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHECKER_BY_LABEL, label)
}
