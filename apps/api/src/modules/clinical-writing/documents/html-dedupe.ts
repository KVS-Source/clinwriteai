// Canonicalise section HTML so no-op saves are recognised despite editor
// jitter.
//
// TipTap occasionally emits slightly different HTML for visually-identical
// states — a trailing empty <p></p> that comes and goes, an extra newline
// between tags, &nbsp; vs. space — which causes the strict string compare
// in updateSection's no-op guard to fail. A new EditHistory row is then
// written on every autosave fire, and sessionizeHistory rolls them up into
// "MANUAL · 3 SAVES" with the WAS and NOW excerpts identical.
//
// This normaliser strips the jitter without erasing semantic markup:
//   - empty <p></p> / <p><br></p> paragraphs collapse to nothing
//   - whitespace between tags is removed
//   - runs of whitespace collapse to a single space
//   - &nbsp; is folded to a regular space
//   - leading / trailing whitespace is trimmed
//
// Formatting changes the writer cares about (bold, italic, headings, lists,
// tables, references, [TBD: …] markers) all survive because the structural
// tags are preserved — we only touch the whitespace the editor adds
// non-deterministically.

const NBSP = /&nbsp;| /g
const EMPTY_P = /<p>\s*(?:<br\s*\/?>\s*)?<\/p>/gi

export function normalizeHtmlForDedupe(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(NBSP, ' ')
    .replace(EMPTY_P, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when two HTML strings are visibly identical under the dedupe
 *  normaliser. Used by the no-op guard in updateSection and the sessions
 *  filter in the history route. */
export function areSectionHtmlsVisiblyEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeHtmlForDedupe(a) === normalizeHtmlForDedupe(b)
}
