// Plain-text excerpt extractor for Section History row previews
// (sPM-autosave + sPM-section-history).
//
// The EditHistory table stores full beforeHtml / afterHtml so Revert can
// restore the exact bytes. The history-list route must NOT ship those full
// blobs down to the browser for every row — a chatty writing session can
// put kilobytes per row × dozens of rows on one GET. Instead, each row
// carries a short plain-text excerpt (default 140 chars) so the UI can
// render "Was: … → Now: …" preview copy without a round-trip, and a
// separate /diff endpoint serves the full HTML on expand.
//
// Design notes:
//   - Pure function, no DOM. The clinical-writing editor stores structured
//     HTML (<p>, <h3>, <ul><li>, <strong>, …). A naive tag strip + whitespace
//     collapse is enough for a preview — fidelity costs we don't need here.
//   - We decode the handful of HTML entities we commonly produce (& < > "
//     ' nbsp) so the preview reads naturally; everything else is passed
//     through (fine for a text excerpt).

const MAX_EXCERPT_CHARS = 140

const ENTITY_MAP: Record<string, string> = {
  amp:    '&',
  lt:     '<',
  gt:     '>',
  quot:   '"',
  '#39':  "'",
  apos:   "'",
  nbsp:   ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (full, name: string) => ENTITY_MAP[name.toLowerCase()] ?? full)
}

/**
 * Collapse HTML to a plain-text excerpt. Returns an empty string for null /
 * empty input so the UI can show "(empty)" placeholder copy. Length defaults
 * to 140 chars + "…" when truncation happens.
 */
export function htmlExcerpt(html: string | null | undefined, maxChars: number = MAX_EXCERPT_CHARS): string {
  if (!html) return ''
  // Block-level elements become spaces so adjacent paragraphs don't glue
  // together ("foobar" instead of "foo bar"). Inline tags are just stripped.
  const BLOCK = /<\/?(p|br|div|li|ul|ol|h[1-6]|blockquote|table|thead|tbody|tr|th|td|pre)\b[^>]*>/gi
  const spaced = html.replace(BLOCK, ' ')
  const stripped = spaced.replace(/<[^>]+>/g, '')
  const decoded = decodeEntities(stripped)
  const collapsed = decoded.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  // Truncate on a word boundary within the last 20 chars when possible so
  // the ellipsis doesn't mid-cut a word.
  const slice = collapsed.slice(0, maxChars)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > maxChars - 20 ? slice.slice(0, lastSpace) : slice
  return `${cut}…`
}
