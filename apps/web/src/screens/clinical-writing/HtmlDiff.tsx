// Structure-preserving section diff for the Version Diff tab.
//
// The word diff used to run on the section flattened to plain text, so tables,
// lists and paragraph breaks collapsed into one run-on line. Here the "to"
// version's HTML keeps its structure: each text block (paragraph, heading,
// list item, table cell) is matched to a block in the "from" version, and only
// the words inside a changed block are marked. Unchanged blocks render as-is,
// inline formatting included. Blocks that only exist in "from" are shown as
// struck-through lines just before where they used to sit (outside any table,
// so the table grid is never broken).
//
// Output is built as React elements from an allow-list of tags — the stored
// HTML is never injected as markup.

import type React from 'react'
import { createElement, Fragment } from 'react'
import { wordDiff } from '../../panels/wordDiff'

const DEL_STYLE = { backgroundColor: '#FEE2E2', color: '#DC2626', textDecoration: 'line-through', borderRadius: 2, padding: '0 2px' } as const
const INS_STYLE = { backgroundColor: '#DCFCE7', color: '#15803D', textDecoration: 'none', borderRadius: 2, padding: '0 2px' } as const

const BLOCK_TAGS    = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'PRE', 'BLOCKQUOTE']
const BLOCK_SEL     = BLOCK_TAGS.join(',')
// A block inside a table cell (the editor wraps cell text in <p>).
const isCell        = (el: Element) => el.closest('td,th') !== null
const blockText     = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const blockKey      = (el: Element) => `${isCell(el) ? 'cell' : 'text'}:${blockText(el)}`

// Tags rendered as themselves; anything else renders just its children.
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'br', 'hr', 'span', 'mark', 'del', 'ins',
])
const VOID_TAGS = new Set(['br', 'hr', 'col'])
// Dropped with their contents — never rendered, not even as text.
const DROP_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript'])

function parseBody(html: string): HTMLElement {
  const body = new DOMParser().parseFromString(html || '', 'text/html').body
  // Loose top-level text (plain-text sections) becomes a paragraph so it's a block too.
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const p = body.ownerDocument.createElement('p')
      body.replaceChild(p, node)
      p.appendChild(node)
    }
  }
  return body
}

// Leaf text blocks in document order (a <li> or <td> wrapping <p>s yields the <p>s).
function collectBlocks(root: Element): Element[] {
  const out: Element[] = []
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (BLOCK_TAGS.includes(child.tagName) && !child.querySelector(BLOCK_SEL)) out.push(child)
      else walk(child)
    }
  }
  walk(root)
  return out
}

type Pair = { from?: Element; to?: Element }

// LCS on block keys; unmatched blocks between two matches are paired up in
// order (same kind → a changed block), leftovers are inserted / removed.
function alignBlocks(a: Element[], b: Element[]): Pair[] {
  const ka = a.map(blockKey), kb = b.map(blockKey)
  const n = a.length, m = b.length
  const matches: Array<[number, number]> = []
  if (n * m <= 1_000_000) {
    const dp = new Int32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = ka[i] === kb[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1])
      }
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (ka[i] === kb[j]) { matches.push([i, j]); i++; j++ }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++
      else j++
    }
  }

  const pairs: Pair[] = []
  const pairGap = (ga: Element[], gb: Element[]) => {
    const k = Math.min(ga.length, gb.length)
    for (let x = 0; x < k; x++) {
      if (isCell(ga[x]!) === isCell(gb[x]!)) pairs.push({ from: ga[x], to: gb[x] })
      else { pairs.push({ from: ga[x] }); pairs.push({ to: gb[x] }) }
    }
    for (const el of ga.slice(k)) pairs.push({ from: el })
    for (const el of gb.slice(k)) pairs.push({ to: el })
  }
  let pi = 0, pj = 0
  for (const [i, j] of matches) {
    pairGap(a.slice(pi, i), b.slice(pj, j))
    pairs.push({ from: a[i], to: b[j] })
    pi = i + 1; pj = j + 1
  }
  pairGap(a.slice(pi), b.slice(pj))
  return pairs
}

function replaceWithWordDiff(target: Element, beforeText: string, afterText: string) {
  const doc = target.ownerDocument
  const { ops } = wordDiff(beforeText, afterText)
  target.replaceChildren()
  ops.forEach((op, i) => {
    const text = op.words.join(' ')
    if (op.type === 'eq') target.appendChild(doc.createTextNode(text))
    else {
      const mark = doc.createElement(op.type)
      mark.textContent = text
      target.appendChild(mark)
    }
    if (i < ops.length - 1) target.appendChild(doc.createTextNode(' '))
  })
}

// Removed blocks as struck-through paragraphs; removed cells of one row share a line.
function removedParagraphs(doc: Document, removed: Element[]): HTMLElement[] {
  const lines: Array<{ row: Element | null; texts: string[] }> = []
  for (const el of removed) {
    const text = blockText(el)
    if (!text) continue
    const row = el.closest('tr')
    const last = lines[lines.length - 1]
    if (row && last && last.row === row) last.texts.push(text)
    else lines.push({ row, texts: [text] })
  }
  return lines.map(line => {
    const p = doc.createElement('p')
    p.setAttribute('data-diff-removed-block', '')
    const del = doc.createElement('del')
    del.textContent = line.texts.join(' | ')
    p.appendChild(del)
    return p
  })
}

// The top-level element (direct child of body) that holds `el`.
function topLevel(el: Element, body: HTMLElement): Element {
  let cur: Element = el
  while (cur.parentElement && cur.parentElement !== body) cur = cur.parentElement
  return cur
}

/** Marks the "to" HTML with word-level changes against "from"; returns the body. */
export function buildHtmlDiff(fromHtml: string, toHtml: string): HTMLElement {
  const fromBody = parseBody(fromHtml)
  const toBody   = parseBody(toHtml)
  const pairs    = alignBlocks(collectBlocks(fromBody), collectBlocks(toBody))
  const doc      = toBody.ownerDocument

  let pendingRemoved: Element[] = []
  const flushRemovedBefore = (anchor: Element | null) => {
    if (pendingRemoved.length === 0) return
    for (const p of removedParagraphs(doc, pendingRemoved)) {
      if (anchor) toBody.insertBefore(p, anchor)
      else toBody.appendChild(p)
    }
    pendingRemoved = []
  }

  for (const { from, to } of pairs) {
    if (from && !to) { pendingRemoved.push(from); continue }
    if (!to) continue
    flushRemovedBefore(topLevel(to, toBody))
    if (!from) {
      if (!blockText(to)) continue
      const ins = doc.createElement('ins')
      ins.append(...Array.from(to.childNodes))
      to.appendChild(ins)
      continue
    }
    const before = blockText(from), after = blockText(to)
    if (before !== after) replaceWithWordDiff(to, before, after)
  }
  flushRemovedBefore(null)
  return toBody
}

function toReact(node: Node, key: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el  = node as Element
  const tag = el.tagName.toLowerCase()
  if (DROP_TAGS.has(tag)) return null
  const children = Array.from(el.childNodes).map((c, i) => toReact(c, i))
  if (!ALLOWED_TAGS.has(tag)) return createElement(Fragment, { key }, ...children)

  const props: Record<string, unknown> = { key }
  if (tag === 'td' || tag === 'th') {
    const colSpan = Number(el.getAttribute('colspan')), rowSpan = Number(el.getAttribute('rowspan'))
    if (colSpan > 1) props.colSpan = colSpan
    if (rowSpan > 1) props.rowSpan = rowSpan
  }
  if (tag === 'del') { props.style = DEL_STYLE; props['data-diff-del'] = '' }
  if (tag === 'ins') { props.style = INS_STYLE; props['data-diff-ins'] = '' }
  if (el.hasAttribute('data-diff-removed-block')) props['data-diff-removed-block'] = ''
  return VOID_TAGS.has(tag) ? createElement(tag, props) : createElement(tag, props, ...children)
}

/** One section's comparison, keeping its paragraphs, lists and tables. */
export function HtmlDiff({ fromHtml, toHtml }: { fromHtml: string; toHtml: string }) {
  const body = buildHtmlDiff(fromHtml, toHtml)
  return (
    <div className="tiptap-editor mt-3 text-sm leading-[1.9] text-slate-900 [&_p]:my-1" data-diff-html>
      {Array.from(body.childNodes).map((c, i) => toReact(c, i))}
    </div>
  )
}
