// CME MCQ structural validator (Package D-3, migration 105 follow-up).
//
// Closes the "CME MCQ structural validator deferred" item from the
// Module C plan. Fires AFTER the shared retry wrapper returns, on
// CME content types, when the AI rewrote an assessment-style section.
// Soft flag — doesn't trigger a retry; author sees the issue on the
// section badge and can re-prompt.
//
// MCQ structural contract (minimum):
//   - A recognisable question line (ends in '?' OR starts with
//     "Question N:" / numbered "1." pattern).
//   - At least 4 answer options, each labelled (A. / A) / 1. / 1) /
//     a. / a) ).
//   - EXACTLY one option marked correct — supported markers:
//       "Correct answer: X"       (end-of-question footer)
//       "Correct: X"
//       "[correct]" tag inline on the option line
//       "*" prefix on the option (asterisk-marks-correct convention)
//       "(correct)" suffix
//
// The validator is intentionally forgiving — Medical hasn't landed a
// structured MCQ schema yet (deferred per schema.prisma line 21),
// so we meet authors where their HTML already is. False-positive
// rate is accepted as low-cost: author sees the flag + decides
// whether to fix the structure or clear it.
//
// Scope — only runs when:
//   - item.type === 'cme_module' AND
//   - the rewritten section has a title / id matching "assessment" or
//     the content body itself has MCQ-looking shape.
//
// Flag: 'mcq_structure_invalid' — soft (weight 15 in FLAG_WEIGHTS).

const QUESTION_LINE_RE  = /(?:^|>)\s*(?:question\s+\d+[:.]|\d+[.)]\s)[^?<]*?\?/gi
// Only accept letter-labelled options (A/B/C/D); numeric labels
// collide with numbered-question lines (e.g. "1. Which ...?"). Most
// MCQs use letter labels anyway.
const OPTION_LINE_RE    = /(?:^|>|\n)\s*(?:\*\s*)?[A-Da-d][.)]\s[^<\n]+/g
const CORRECT_MARKER_RE = /correct(?:\s+answer)?\s*[:=]\s*([A-Da-d]|[1-9]\d?)|\[\s*correct\s*\]|\(\s*correct\s*\)|^\s*\*/im
const MCQ_SIGNAL_RE     = /\?/   // at least one question mark present

export interface McqValidationResult {
  looksLikeMcq:        boolean
  questionCount:       number
  optionCount:         number
  correctMarkerCount:  number
  structurallyValid:   boolean
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** Heuristic structural check for an MCQ block. Returns whether the
 *  input looks like it was intended as MCQ-style content, and whether
 *  the structural contract (questions + 4 options each + exactly one
 *  correct marker) is satisfied. Pure. */
export function validateMcqStructure(html: string): McqValidationResult {
  if (!html || html.trim().length === 0) {
    return { looksLikeMcq: false, questionCount: 0, optionCount: 0, correctMarkerCount: 0, structurallyValid: true }
  }
  const text = stripHtml(html)
  const looksLikeMcq = MCQ_SIGNAL_RE.test(text) && /\b[A-Da-d][.)]/.test(text)
  if (!looksLikeMcq) {
    // Not an MCQ block — don't flag anything.
    return { looksLikeMcq: false, questionCount: 0, optionCount: 0, correctMarkerCount: 0, structurallyValid: true }
  }
  const questions = html.match(QUESTION_LINE_RE)
  const options   = html.match(OPTION_LINE_RE)
  const correctMarkers = html.match(new RegExp(CORRECT_MARKER_RE.source, 'img'))

  const questionCount      = questions?.length ?? 0
  const optionCount        = options?.length ?? 0
  const correctMarkerCount = correctMarkers?.length ?? 0

  // Structural rules — all three must hold:
  //   - at least 1 question
  //   - options count is a multiple of 4 (one per question) AND >= 4
  //   - exactly one correct marker per question (so total markers == question count)
  const structurallyValid = questionCount >= 1
    && optionCount >= 4
    && optionCount % 4 === 0
    && correctMarkerCount === questionCount

  return { looksLikeMcq, questionCount, optionCount, correctMarkerCount, structurallyValid }
}

/** True when the content type uses MCQs. Tight scope — only CME today. */
export function isMcqGatedType(type: string): boolean {
  return type === 'cme_module'
}
