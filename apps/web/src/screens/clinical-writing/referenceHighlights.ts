// Visual marking of reference-linked text in the editor, without touching the editor's DOM.
//
// A reference link stores the cited text. To show it in the section we find that text in the
// rendered content and register a DOM Range with the CSS Custom Highlight API
// (`::highlight(source-ref)` in index.css). Nothing is wrapped or mutated, so TipTap / React are
// unaffected. Browsers without the API simply don't show the marks; the panel list still works.

export const HIGHLIGHT_NAME = 'source-ref'

export interface LinkedRange { id: string; range: Range }

/** Collapse runs of whitespace the same way when saving a selection and when searching for it. */
export const normalizeSpan = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Find `text` (whitespace-insensitive) inside `root`'s text nodes. Returns a Range or null.
 * Matches the first occurrence only.
 */
export function findTextRange(root: Node, text: string): Range | null {
  const needle = normalizeSpan(text)
  if (!needle) return null

  // Build a whitespace-collapsed copy of the text, remembering where each character came from.
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let haystack = ''
  const origin: Array<{ node: Text; offset: number }> = []
  let lastWasSpace = true   // swallow leading whitespace
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const value = n.nodeValue ?? ''
    for (let i = 0; i < value.length; i++) {
      const isSpace = /\s/.test(value[i]!)
      if (isSpace && lastWasSpace) continue
      haystack += isSpace ? ' ' : value[i]
      origin.push({ node: n, offset: i })
      lastWasSpace = isSpace
    }
    // block boundaries read as a space between text nodes
    if (!lastWasSpace) { haystack += ' '; origin.push({ node: n, offset: value.length }); lastWasSpace = true }
  }

  const at = haystack.indexOf(needle)
  if (at < 0) return null
  const start = origin[at]!
  const end = origin[at + needle.length - 1]!
  const range = window.document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, Math.min(end.offset + 1, end.node.length))
  return range
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
const registry = (): HighlightRegistry | null =>
  (typeof CSS !== 'undefined' && (CSS as unknown as { highlights?: HighlightRegistry }).highlights) || null

/** Highlight each reference's text. Returns the ranges (for click hit-testing). */
export function applyReferenceHighlights(root: Node, refs: Array<{ id: string; spanText: string }>): LinkedRange[] {
  const found: LinkedRange[] = []
  for (const r of refs) {
    const range = findTextRange(root, r.spanText)
    if (range) found.push({ id: r.id, range })
  }
  const reg = registry()
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (reg && HighlightCtor) {
    if (found.length) reg.set(HIGHLIGHT_NAME, new HighlightCtor(...found.map(f => f.range)))
    else reg.delete(HIGHLIGHT_NAME)
  }
  return found
}

export function clearReferenceHighlights() {
  registry()?.delete(HIGHLIGHT_NAME)
}

/** Which reference (if any) is under the given viewport point. */
export function referenceAtPoint(found: LinkedRange[], x: number, y: number): string | null {
  const d = window.document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let offset = 0
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (p) { node = p.offsetNode; offset = p.offset }
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node) return null
  for (const f of found) {
    try { if (f.range.isPointInRange(node, offset)) return f.id } catch { /* detached range */ }
  }
  return null
}
