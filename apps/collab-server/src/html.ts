// Y.XmlFragment → HTML, for saving a room back to the API.
//
// The editor's Yjs binding stores ProseMirror node names (paragraph, tableRow, …)
// and keeps marks as attributes on the text, so neither can be written out as they
// are: every node needs its HTML tag, and every mark needs wrapping around its text.
// The output has to match what the editor's own getHTML() saves, because the same
// editor reads it back. The nodes and marks are those of defaultExtensions() in
// apps/web/src/screens/clinical-writing/RichTextEditor.tsx; add new ones here too.

import * as Y from 'yjs'

const NODE_TAGS: Record<string, string> = {
  paragraph:   'p',
  blockquote:  'blockquote',
  bulletList:  'ul',
  orderedList: 'ol',
  listItem:    'li',
  tableRow:    'tr',
  tableHeader: 'th',
  tableCell:   'td',
}

// Outermost first, so the same text always produces the same HTML.
const MARK_TAGS: ReadonlyArray<readonly [string, string]> = [
  ['bold',      'strong'],
  ['italic',    'em'],
  ['underline', 'u'],
  ['strike',    's'],
  ['code',      'code'],
]

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

// A mark that can overlap itself is stored under a hashed name: "link--a1b2c3d4".
const markName = (attribute: string) => attribute.replace(/--[a-zA-Z0-9+/=]{8}$/, '')

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

function attrString(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')
}

function isSafeHref(href: string): boolean {
  // Browsers ignore whitespace and control characters inside a scheme ("java\nscript:").
  // eslint-disable-next-line no-control-regex
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000- ]/g, ''))
  return !scheme || SAFE_LINK_SCHEMES.has(scheme[1]!.toLowerCase())
}

function textToHtml(node: Y.XmlText): string {
  let out = ''
  for (const op of node.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
    if (typeof op.insert !== 'string') continue
    const marks = new Map(Object.entries(op.attributes ?? {}).map(([k, v]) => [markName(k), v]))
    let html = escapeHtml(op.insert)
    for (const [mark, tag] of [...MARK_TAGS].reverse()) {
      if (marks.has(mark)) html = `<${tag}>${html}</${tag}>`
    }
    const link = marks.get('link') as { href?: unknown; target?: unknown; rel?: unknown; class?: unknown } | undefined
    if (typeof link?.href === 'string' && isSafeHref(link.href)) {
      html = `<a${attrString({ href: link.href, target: link.target, rel: link.rel, class: link.class })}>${html}</a>`
    }
    out += html
  }
  return out
}

function childrenToHtml(parent: Y.XmlFragment): string {
  let out = ''
  parent.forEach(child => { out += nodeToHtml(child) })
  return out
}

function nodeToHtml(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return textToHtml(node)
  if (node instanceof Y.XmlHook) return ''

  const name = node.nodeName
  const attrs = node.getAttributes() as Record<string, unknown>
  const inner = childrenToHtml(node)

  switch (name) {
    case 'hardBreak':      return '<br>'
    case 'horizontalRule': return '<hr>'
    case 'heading': {
      const level = Number(attrs.level)
      const tag = Number.isInteger(level) && level >= 1 && level <= 6 ? `h${level}` : 'p'
      return `<${tag}>${inner}</${tag}>`
    }
    case 'codeBlock': {
      const language = typeof attrs.language === 'string' && attrs.language ? `language-${attrs.language}` : undefined
      return `<pre><code${attrString({ class: language })}>${inner}</code></pre>`
    }
    case 'table':
      return `<table class="tiptap-table"><tbody>${inner}</tbody></table>`
    case 'tableHeader':
    case 'tableCell': {
      const tag = NODE_TAGS[name]
      const span = (v: unknown) => (Number(v) > 1 ? Number(v) : undefined)
      const widths = Array.isArray(attrs.colwidth) ? attrs.colwidth.join(',') : undefined
      return `<${tag}${attrString({ colspan: span(attrs.colspan), rowspan: span(attrs.rowspan), 'data-colwidth': widths })}>${inner}</${tag}>`
    }
    case 'orderedList': {
      const start = Number(attrs.start) > 1 ? Number(attrs.start) : undefined
      return `<ol${attrString({ start, type: attrs.type })}>${inner}</ol>`
    }
  }

  const tag = NODE_TAGS[name]
  // A node type this file doesn't know: keep its text rather than write a made-up tag.
  return tag ? `<${tag}>${inner}</${tag}>` : inner
}

export function xmlFragmentToHtml(fragment: Y.XmlFragment): string {
  return childrenToHtml(fragment)
}

// False for what an editor holds before anyone has typed (an empty paragraph).
export function htmlHasContent(html: string): boolean {
  return /<(?:hr|table)\b/.test(html) || html.replace(/<[^>]*>/g, '').trim() !== ''
}
