// Escape-hatch token parser — reads the carry-prompt model response and
// extracts the four flag tokens the system prompt instructs the model to
// emit instead of fabricating:
//
//   [Information Required: <what is needed>]
//   [Conflict: <A> vs <B> — needs clarification]
//   [Reference Verification Required: <sourceId>]
//   [Missing Cross-Ref Target: <item>]
//
// Why parse server-side: the UI needs them as structured rows (yellow
// cards in the AI chat panel, badge counts in the doc header, audit
// details). Parsing server-side keeps every client coherent and lets
// future worker loops (initial-draft validation, chat-event stream)
// consume the same shape.
//
// Position in the response text is captured so the UI can highlight the
// exact span the model flagged — useful for "jump to flag" interactions.
//
// Pure function: no DB, no clock. Idempotent — parsing the same text
// twice returns the same objects. Tokens are NOT removed from the text
// (callers get both the parsed rows and the original string); step D of
// the chat-event parser will decide what to persist in brief.openFlags.

export type FlagTokenType =
  | 'information_required'
  | 'conflict'
  | 'reference_verification_required'
  | 'missing_cross_ref_target'

export interface FlagToken {
  type:       FlagTokenType
  /** The body of the bracketed phrase — what comes after the colon,
   *  trimmed. Empty string when the model emitted an empty body (still
   *  worth surfacing so the UI can show "model flagged X, no details"). */
  text:       string
  /** Byte offset of the opening `[` in the response text. */
  start:      number
  /** Byte offset one past the closing `]`. Non-inclusive end bound. */
  end:        number
  /** The literal matched text, including the brackets — convenient for
   *  the UI when it wants to replace / strip it. */
  match:      string
}

// Label → canonical type. Matching is case-insensitive on the label,
// space-tolerant (single or multi-space after the colon, trim body).
const LABELS: Array<{ label: string; type: FlagTokenType }> = [
  { label: 'Information Required',            type: 'information_required' },
  { label: 'Conflict',                        type: 'conflict' },
  { label: 'Reference Verification Required', type: 'reference_verification_required' },
  { label: 'Missing Cross-Ref Target',        type: 'missing_cross_ref_target' },
]

// Build a single regex that captures the label + body in one pass. The
// label alternation uses the canonical casing but the overall match is
// case-insensitive via the `i` flag.
//
//   \[(label1|label2|...)\s*:\s*([^\]]*)\]
//
// `[^\]]*` inside the body stops at the next `]`; nested brackets in
// the body are not supported (the SME prompt never asks for them).
const LABEL_ALT = LABELS.map(l => l.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const TOKEN_RE  = new RegExp(`\\[(${LABEL_ALT})\\s*:\\s*([^\\]]*)\\]`, 'gi')

export function parseFlagTokens(text: string): FlagToken[] {
  if (!text) return []
  const out: FlagToken[] = []
  // Reset lastIndex because the regex has the `g` flag and we reuse it.
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const rawLabel = (m[1] ?? '').trim()
    const body     = (m[2] ?? '').trim()
    const type = LABELS.find(l => l.label.toLowerCase() === rawLabel.toLowerCase())?.type
    if (!type) continue                                  // shouldn't happen — regex only matches known labels
    out.push({
      type,
      text:  body,
      start: m.index,
      end:   m.index + m[0].length,
      match: m[0],
    })
  }
  return out
}

/** Roll-up counts per token type — convenient for audit payloads. */
export function summariseFlagTokens(tokens: FlagToken[]): Record<FlagTokenType, number> {
  const summary: Record<FlagTokenType, number> = {
    information_required:            0,
    conflict:                        0,
    reference_verification_required: 0,
    missing_cross_ref_target:        0,
  }
  for (const t of tokens) summary[t.type] += 1
  return summary
}
