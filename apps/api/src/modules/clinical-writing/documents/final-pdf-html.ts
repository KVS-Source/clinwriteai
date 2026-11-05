// Section HTML → the blocks the Final Document PDF draws. Stored HTML is parsed, never trusted:
// scripts, styles and anything else that isn't document text are dropped.

import { parseFragment } from 'parse5'

export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  script?: 'sub' | 'sup'
  link?: string
}

export interface TableCell { text: string; bold: boolean; header: boolean; colSpan: number; rowSpan: number }

export type Block =
  | { kind: 'heading'; level: number; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'pre'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; caption: string | null; rows: TableCell[][] }
  | { kind: 'rule' }

type Node = {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: Node[]
}

const DROPPED = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'head', 'title', 'meta', 'link', 'img', 'svg', 'math', 'colgroup', 'col'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav', 'figure', 'figcaption', 'address', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr'])

const tagOf = (n: Node) => n.tagName?.toLowerCase() ?? ''
const attr = (n: Node, name: string) => n.attrs?.find(a => a.name === name)?.value
const isBlockish = (n: Node): boolean => BLOCK.has(tagOf(n))
const span = (v: string | undefined) => Math.min(50, Math.max(1, Number.parseInt(v ?? '1', 10) || 1))

function inlineMarks(tag: string, node: Node, marks: Omit<InlineRun, 'text'>): Omit<InlineRun, 'text'> {
  switch (tag) {
    case 'strong': case 'b': return { ...marks, bold: true }
    case 'em': case 'i': case 'cite': return { ...marks, italic: true }
    case 'u': case 'ins': return { ...marks, underline: true }
    case 's': case 'strike': case 'del': return { ...marks, strike: true }
    case 'code': case 'kbd': case 'samp': return { ...marks, code: true }
    case 'sub': return { ...marks, script: 'sub' }
    case 'sup': return { ...marks, script: 'sup' }
    case 'a': {
      const href = attr(node, 'href') ?? ''
      // Only ordinary links, so a stored javascript: URL never reaches the file.
      return /^(https?:|mailto:)/i.test(href) ? { ...marks, link: href, underline: true } : marks
    }
    default: return marks
  }
}

function collectRuns(nodes: Node[], marks: Omit<InlineRun, 'text'>, out: InlineRun[]): void {
  for (const n of nodes) {
    if (n.nodeName === '#text') {
      if (n.value) out.push({ ...marks, text: n.value.replace(/[ \t\r\n\f]+/g, ' ') })
      continue
    }
    const tag = tagOf(n)
    if (!tag || DROPPED.has(tag)) continue
    if (tag === 'br') { out.push({ ...marks, text: '\n' }); continue }
    collectRuns(n.childNodes ?? [], inlineMarks(tag, n, marks), out)
  }
}

/** Trims the ends and the spaces around line breaks, as a browser does, and joins like neighbours. */
function tidyRuns(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = []
  for (const r of runs) {
    let text = r.text
    const before = out[out.length - 1]
    if (!before || before.text.endsWith(' ') || before.text.endsWith('\n')) text = text.replace(/^ +/, '')
    if (!text) continue
    const { text: _b, ...bm } = before ?? { text: '' }
    const { text: _r, ...rm } = r
    if (before && JSON.stringify(bm) === JSON.stringify(rm)) before.text += text
    else out.push({ ...r, text })
  }
  const last = out[out.length - 1]
  if (last) last.text = last.text.replace(/[ \n]+$/, '')
  return out.filter(r => r.text)
}

const runsOf = (nodes: Node[]): InlineRun[] => {
  const runs: InlineRun[] = []
  collectRuns(nodes, {}, runs)
  return tidyRuns(runs)
}

function toBlocks(nodes: Node[]): Block[] {
  const out: Block[] = []
  let pending: Node[] = []
  const flush = () => {
    if (!pending.length) return
    const runs = runsOf(pending)
    if (runs.length) out.push({ kind: 'paragraph', runs })
    pending = []
  }
  for (const n of nodes) {
    const tag = tagOf(n)
    if (n.nodeName !== '#text' && (!tag || DROPPED.has(tag))) continue
    if (n.nodeName === '#text' || !isBlockish(n)) {
      // An inline element that wraps a block (<span><p>..</p></span>) reads as the block.
      if (n.childNodes?.some(isBlockish)) { flush(); out.push(...toBlocks(n.childNodes)); continue }
      pending.push(n)
      continue
    }
    flush()
    const kids = n.childNodes ?? []
    if (/^h[1-6]$/.test(tag)) {
      const runs = runsOf(kids)
      if (runs.length) out.push({ kind: 'heading', level: Number(tag[1]), runs })
    } else if (tag === 'p' || tag === 'dt') {
      const nested = kids.some(isBlockish)
      if (nested) out.push(...toBlocks(kids))
      else {
        const runs = runsOf(kids)
        if (runs.length) out.push({ kind: 'paragraph', runs })
      }
    } else if (tag === 'pre') {
      const text = collectText(kids).replace(/\n$/, '')
      if (text) out.push({ kind: 'pre', text })
    } else if (tag === 'ul' || tag === 'ol') {
      const items = kids.filter(k => tagOf(k) === 'li').map(k => toBlocks(k.childNodes ?? []))
      if (items.length) out.push({ kind: 'list', ordered: tag === 'ol', start: span(attr(n, 'start')), items })
    } else if (tag === 'blockquote') {
      const blocks = toBlocks(kids)
      if (blocks.length) out.push({ kind: 'quote', blocks })
    } else if (tag === 'table') {
      const table = toTable(n)
      if (table) out.push(table)
    } else if (tag === 'hr') {
      out.push({ kind: 'rule' })
    } else {
      out.push(...toBlocks(kids))
    }
  }
  flush()
  return out
}

function collectText(nodes: Node[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.nodeName === '#text') out += n.value ?? ''
    else if (tagOf(n) === 'br') out += '\n'
    else if (!DROPPED.has(tagOf(n))) out += collectText(n.childNodes ?? [])
  }
  return out
}

/** A cell's text: its paragraphs and list items on their own lines. */
function plainLines(blocks: Block[]): string[] {
  return blocks.flatMap((b): string[] => {
    switch (b.kind) {
      case 'heading': case 'paragraph': return [b.runs.map(r => r.text).join('')]
      case 'pre': return [b.text]
      case 'list': return b.items.flatMap((item, i) => {
        const [first = '', ...rest] = plainLines(item)
        return [`${b.ordered ? `${b.start + i}.` : '•'} ${first}`, ...rest]
      })
      case 'quote': return plainLines(b.blocks)
      case 'table': return b.rows.map(row => row.map(c => c.text).join(' | '))
      case 'rule': return []
    }
  })
}

const everyRun = (blocks: Block[], test: (r: InlineRun) => boolean): boolean => {
  const runs = blocks.flatMap((b): InlineRun[] => (b.kind === 'heading' || b.kind === 'paragraph' ? b.runs : []))
  return runs.length > 0 && runs.every(test)
}

function toTable(table: Node): Extract<Block, { kind: 'table' }> | null {
  const rows: TableCell[][] = []
  let caption: string | null = null
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      const tag = tagOf(n)
      if (tag === 'caption') caption = plainLines(toBlocks(n.childNodes ?? [])).join(' ') || null
      else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') walk(n.childNodes ?? [])
      else if (tag === 'tr') {
        const cells = (n.childNodes ?? []).filter(c => tagOf(c) === 'td' || tagOf(c) === 'th').map((c): TableCell => {
          const blocks = toBlocks(c.childNodes ?? [])
          const header = tagOf(c) === 'th'
          return {
            text: plainLines(blocks).join('\n'),
            bold: header || everyRun(blocks, r => !!r.bold),
            header,
            colSpan: span(attr(c, 'colspan')),
            rowSpan: span(attr(c, 'rowspan')),
          }
        })
        if (cells.length) rows.push(cells)
      }
    }
  }
  walk(table.childNodes ?? [])
  return rows.length ? { kind: 'table', caption, rows } : null
}

export function htmlToBlocks(html: string | null | undefined): Block[] {
  if (!html) return []
  return toBlocks((parseFragment(html) as unknown as Node).childNodes ?? [])
}
