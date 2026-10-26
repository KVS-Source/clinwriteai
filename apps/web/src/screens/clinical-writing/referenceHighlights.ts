// Visual marking of reference-linked text in the editor, without touching the editor's DOM.
//
// A reference link stores the cited text. To show it in the section we find that text in the
// rendered content and register a DOM Range with the CSS Custom Highlight API
// (`::highlight(source-ref)` in index.css). Nothing is wrapped or mutated, so TipTap / React are
// unaffected. Browsers without the API simply don't show the marks; the panel list still works.

export const HIGHLIGHT_NAME = 'source-ref'

export interface LinkedRange { id: string; range: Range; start: number; end: number }

/** Collapse runs of whitespace the same way when saving a selection and when searching for it. */
export const normalizeSpan = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The section's text with whitespace collapsed (block boundaries read as one space), and for each
 * character the text node + offset it came from. Reference offsets (startOffset / endOffset) are
 * positions in this collapsed text.
 */
export interface TextIndex { text: string; origin: Array<{ node: Text; offset: number }> }

export function buildTextIndex(root: Node): TextIndex {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const origin: TextIndex['origin'] = []
  let lastWasSpace = true   // swallow leading whitespace
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const value = n.nodeValue ?? ''
    for (let i = 0; i < value.length; i++) {
      const isSpace = /\s/.test(value[i]!)
      if (isSpace && lastWasSpace) continue
      text += isSpace ? ' ' : value[i]
      origin.push({ node: n, offset: i })
      lastWasSpace = isSpace
    }
    // block boundaries read as a space between text nodes
    if (!lastWasSpace) { text += ' '; origin.push({ node: n, offset: value.length }); lastWasSpace = true }
  }
  return { text, origin }
}

/**
 * Where `text` sits in the index. With a stored `near` offset: the exact spot if the wording is
 * still there, else the occurrence closest to it (the section was edited around it). Without
 * one (older references): the first occurrence.
 */
export function locateSpan(index: TextIndex, text: string, near?: number | null): { start: number; end: number } | null {
  const needle = normalizeSpan(text)
  if (!needle) return null
  if (near != null && index.text.slice(near, near + needle.length) === needle) return { start: near, end: near + needle.length }
  let best = -1
  for (let at = index.text.indexOf(needle); at >= 0; at = index.text.indexOf(needle, at + 1)) {
    if (near == null) { best = at; break }
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at
  }
  return best < 0 ? null : { start: best, end: best + needle.length }
}

/** A DOM Range covering index characters [start, end). */
export function rangeFromSpan(index: TextIndex, span: { start: number; end: number }): Range | null {
  const a = index.origin[span.start]
  const b = index.origin[span.end - 1]
  if (!a || !b) return null
  const range = window.document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, Math.min(b.offset + 1, b.node.length))
  return range
}

/** Where a DOM selection Range sits in the index (spaces at either end trimmed), or null if it's outside. */
export function spanOfRange(index: TextIndex, range: Range): { start: number; end: number } | null {
  const inside = (node: Text, offset: number) => {
    try { return range.comparePoint(node, offset) === 0 } catch { return false }
  }
  let start = -1
  let end = -1
  index.origin.forEach(({ node, offset }, i) => {
    if (inside(node, offset) && inside(node, Math.min(offset + 1, node.length))) {
      if (start < 0) start = i
      end = i + 1
    }
  })
  while (start >= 0 && start < end && index.text[start] === ' ') start++
  while (end > start && index.text[end - 1] === ' ') end--
  return start < 0 || end <= start ? null : { start, end }
}

/** Two spans share at least one character. */
export const spansOverlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

/**
 * Find `text` (whitespace-insensitive) inside `root`'s text nodes. Returns a Range or null.
 * Matches the first occurrence only.
 */
export function findTextRange(root: Node, text: string): Range | null {
  const index = buildTextIndex(root)
  const span = locateSpan(index, text)
  return span ? rangeFromSpan(index, span) : null
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
const registry = (): HighlightRegistry | null =>
  (typeof CSS !== 'undefined' && (CSS as unknown as { highlights?: HighlightRegistry }).highlights) || null

/** Highlight each reference's text, at its stored position when it has one. Returns the ranges (for hit-testing and overlap checks). */
export function applyReferenceHighlights(root: Node, refs: Array<{ id: string; spanText: string; startOffset?: number | null }>): LinkedRange[] {
  const found: LinkedRange[] = []
  const index = buildTextIndex(root)
  for (const r of refs) {
    const span = locateSpan(index, r.spanText, r.startOffset)
    const range = span && rangeFromSpan(index, span)
    if (span && range) found.push({ id: r.id, range, ...span })
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

/**
 * Viewport rectangles of the text a range covers, one per line fragment. Range.getClientRects()
 * would also return the full-width boxes of block elements inside the range, which would make
 * the blank space beside a short line count as "on the text".
 */
function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer
  const nodes: Text[] = []
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text)
  else {
    const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (range.intersectsNode(n)) nodes.push(n)
    }
  }
  const rects: DOMRect[] = []
  for (const n of nodes) {
    const part = window.document.createRange()
    part.setStart(n, n === range.startContainer ? range.startOffset : 0)
    part.setEnd(n, n === range.endContainer ? range.endOffset : n.length)
    rects.push(...Array.from(part.getClientRects()))
  }
  return rects
}

/**
 * Which reference (if any) is under the given viewport point. The point has to be on the text
 * itself: the browser's caret lookup snaps a click in blank space (beside a line, below the
 * text) to the nearest character, which would otherwise count as a click on that text.
 */
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
  const slop = 1   // px
  for (const f of found) {
    try {
      if (!f.range.isPointInRange(node, offset)) continue
      const onText = textRects(f.range).some(r => x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop)
      if (onText) return f.id
    } catch { /* detached range */ }
  }
  return null
}
