// The Final Document as a PDF, built on the server so every copy has the same layout, rules and
// traceability whichever browser asked for it. In order: title page, contents, the sections,
// Appendix (Compliance Summary), signature page. Every page carries the document's identity and
// the export id that links the file to its audit entry.
//
// A draft (anything not signed) is watermarked on every page and says it isn't signed. Whether
// a document may be exported as signed at all is decided by the route, not here.
//
// Fonts: Liberation Sans, embedded, because clinical text needs ≥, ±, µ, χ and the like, which the
// PDF built-in fonts can't draw. A character it can't draw either isn't dropped: it prints as □ and
// the title page lists it, so the copy never silently differs from the record.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import PDFDocument from 'pdfkit'
import type { ComplianceSummary } from '../checklist/compliance-summary.js'
import { htmlToBlocks, type Block, type InlineRun, type TableCell } from './final-pdf-html.js'

export const DRAFT_WATERMARK = 'DRAFT — NOT SIGNED'

export interface FinalPdfSignature {
  id: string
  signerName: string
  signerRole: string
  meaning: string
  step: number
  timestampUtc: Date | string | null
  authMethod: string | null
  timeSource: string | null
  versionAtSigning: string | null
}

export interface FinalPdfInput {
  exportId: string
  generatedAt: Date
  generatedBy: string
  mode: 'signed' | 'draft'
  document: { id: string; title: string; version: string; statusLabel: string; signedAt: Date | string | null }
  project: { shortTitle: string | null; name: string | null; therapeuticArea: string | null; phase: string | null } | null
  sections: Array<{ number: string; title: string; contentHtml: string | null }>
  compliance: ComplianceSummary
  signatures: FinalPdfSignature[]
  documentHash: string | null
}

export interface FinalPdfResult { pdf: Buffer; pageCount: number; undrawableCharacters: string[] }

// --- Fonts ---------------------------------------------------------------

const FONT = { body: 'Body', bold: 'Body-Bold', italic: 'Body-Italic', boldItalic: 'Body-BoldItalic', mono: 'Courier' } as const
const FONT_FILES = {
  [FONT.body]: 'LiberationSans-Regular.ttf',
  [FONT.bold]: 'LiberationSans-Bold.ttf',
  [FONT.italic]: 'LiberationSans-Italic.ttf',
  [FONT.boldItalic]: 'LiberationSans-BoldItalic.ttf',
}

const require = createRequire(import.meta.url)
let loadedFonts: { files: Record<string, Buffer>; canDraw: (codePoint: number) => boolean } | null = null

function fonts() {
  if (loadedFonts) return loadedFonts
  const dir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')
  const files = Object.fromEntries(Object.entries(FONT_FILES).map(([name, file]) => [name, readFileSync(join(dir, file))]))
  const face = (require('fontkit') as { create(b: Buffer): { hasGlyphForCodePoint(c: number): boolean } }).create(files[FONT.body]!)
  loadedFonts = { files, canDraw: c => face.hasGlyphForCodePoint(c) }
  return loadedFonts
}

// --- Text ----------------------------------------------------------------

const MISSING_MARK = '□'
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
const SUPERSCRIPT_DIGITS: Record<string, string> = { '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }
// Invisible characters that mark nothing on paper.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f​-‏⁠﻿]/g

/** Text the font can draw. Unknown characters become □ and are reported. */
function drawable(text: string, missing: Set<string>): string {
  const { canDraw } = fonts()
  let out = ''
  for (const ch of text.replace(INVISIBLE, '')) {
    if (ch === '\n' || ch === '\t' || canDraw(ch.codePointAt(0)!)) out += ch
    else { missing.add(ch); out += MISSING_MARK }
  }
  return out
}

/** Splits out Unicode sub/superscript digits, which the font lacks, so they're drawn as real ones. */
function splitScriptDigits(run: InlineRun): InlineRun[] {
  const out: InlineRun[] = []
  let buf = ''
  const flush = () => { if (buf) out.push({ ...run, text: buf }); buf = '' }
  for (const ch of run.text) {
    const sub = SUBSCRIPT_DIGITS.indexOf(ch)
    const sup = SUPERSCRIPT_DIGITS[ch]
    if (sub >= 0) { flush(); out.push({ ...run, text: String(sub), script: 'sub' }) }
    else if (sup) { flush(); out.push({ ...run, text: sup, script: 'sup' }) }
    else buf += ch
  }
  flush()
  return out
}

const plainScriptDigits = (text: string) => [...text].map(ch => {
  const sub = SUBSCRIPT_DIGITS.indexOf(ch)
  return sub >= 0 ? String(sub) : (SUPERSCRIPT_DIGITS[ch] ?? ch)
}).join('')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '28 Oct 2026 15:47 UTC', as on the Final Document screen. */
export function formatUtc(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

// Same order as the screen: front matter without a number first, then numbered sections, part by part.
const collator = new Intl.Collator(undefined, { numeric: true })
const sectionKey = (s: { number: string }) => s.number.replace(/^§/, '')
const isFrontMatter = (s: { number: string }) => !/^\d/.test(sectionKey(s))

export function orderSections<T extends { number: string }>(sections: readonly T[]): T[] {
  return [...sections].sort((a, b) => Number(isFrontMatter(b)) - Number(isFrontMatter(a)) || collator.compare(sectionKey(a), sectionKey(b)))
}

const RULE_OUTCOME: Record<string, string> = { complete: 'Met', waived: 'Waived', pending: 'Not completed', 'in-progress': 'Not completed', in_progress: 'Not completed' }
const MEANING: Record<string, string> = { authored: 'Authored', reviewed: 'Reviewed', approved: 'Approved', acknowledged: 'Acknowledged' }

// --- Page geometry -------------------------------------------------------

const PAGE = { top: 62, bottom: 62, left: 48, right: 48 }
const INK = '#0F172A'
const MUTED = '#64748B'
const FAINT = '#94A3B8'
const LINE = '#CBD5E1'
const TABLE_FONT_SIZE = 8.5
const TABLE_PADDING = 4
const FONT_ASCENT = 0.905        // Liberation Sans, as a share of the font size

type Doc = InstanceType<typeof PDFDocument>
type PageLabels = Map<string, number>

const BLANK_CELL: TableCell = { text: '', bold: false, header: false, colSpan: 1, rowSpan: 1 }

/** The columns a table really needs, counting cells carried down from merged rows above. */
function columnCount(rows: TableCell[][]): number {
  const carried: number[] = []
  let columns = 1
  rows.forEach((row, r) => {
    let col = 0
    for (const c of row) {
      while ((carried[col] ?? 0) > r) col++
      for (let k = 0; k < c.colSpan; k++) carried[col + k] = r + c.rowSpan
      col += c.colSpan
    }
    columns = Math.max(columns, col, carried.length)
  })
  return columns
}

/**
 * Stored tables can be uneven, or have a merged row running past the last one; pdfkit needs every
 * row to fill the grid. With keepMerged off, a merged cell keeps its text in its first row and the
 * rows below get a blank in its place, so the columns stay lined up.
 */
function tableGrid(rows: TableCell[][], columns: number, keepMerged: boolean): TableCell[][] {
  const carried = new Array<number>(columns).fill(0)
  return rows.map((row, r) => {
    const queue = [...row]
    const cells: TableCell[] = []
    let col = 0
    while (col < columns) {
      if (carried[col]! > r) {
        if (!keepMerged) cells.push(BLANK_CELL)
        col++
        continue
      }
      const next = queue.shift()
      if (!next) { cells.push(BLANK_CELL); col++; continue }
      let colSpan = 1
      while (colSpan < next.colSpan && col + colSpan < columns && carried[col + colSpan]! <= r) colSpan++
      const rowSpan = Math.min(next.rowSpan, rows.length - r)
      for (let k = col; k < col + colSpan; k++) carried[k] = r + rowSpan
      cells.push({ ...next, colSpan, rowSpan: keepMerged ? rowSpan : 1 })
      col += colSpan
    }
    return cells
  })
}

function renderOnce(input: FinalPdfInput, labels: PageLabels): Promise<FinalPdfResult & { labels: PageLabels }> {
  return new Promise((resolve, reject) => {
    const missing = new Set<string>()
    const t = (s: string | null | undefined) => drawable(s ?? '', missing)
    const signed = input.mode === 'signed'
    const statusLine = signed ? 'Final · Signed' : 'Draft · Not signed'

    const doc: Doc = new PDFDocument({
      size: 'A4',
      margins: PAGE,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: t(input.document.title),
        Author: 'ClinWrite',
        Subject: `${t(input.document.title)} ${input.document.version} (${statusLine})`,
        Keywords: `export:${input.exportId}`,
        CreationDate: input.generatedAt,
      },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('error', reject)
    doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount, undrawableCharacters: [...missing], labels: nextLabels }))

    for (const [name, file] of Object.entries(fonts().files)) doc.registerFont(name, file)
    let pageCount = 0
    const nextLabels: PageLabels = new Map()

    const left = PAGE.left
    const contentWidth = () => doc.page.width - PAGE.left - PAGE.right
    const bottomY = () => doc.page.height - PAGE.bottom
    const currentPage = () => doc.bufferedPageRange().count
    const startPage = () => { doc.addPage(); doc.x = left; doc.y = PAGE.top }
    const ensureRoom = (height: number) => { if (doc.y + height > bottomY()) startPage() }
    const gap = (points: number) => { doc.y += points }

    const heading = (text: string, size: number, opts: { label?: string; outline?: boolean } = {}) => {
      ensureRoom(size * 4)
      doc.x = left
      const page = currentPage()
      if (opts.label) nextLabels.set(opts.label, page)
      if (opts.outline) doc.outline.addItem(t(text))
      doc.font(FONT.bold).fontSize(size).fillColor(INK).text(t(text), { width: contentWidth() })
      gap(size * 0.4)
    }
    const para = (text: string, opts: { size?: number; colour?: string; italic?: boolean; bold?: boolean; after?: number } = {}) => {
      const size = opts.size ?? 10
      ensureRoom(size * 2)
      doc.font(opts.bold ? FONT.bold : opts.italic ? FONT.italic : FONT.body).fontSize(size).fillColor(opts.colour ?? INK)
        .text(t(text), { lineGap: 2 })
      gap(opts.after ?? 6)
    }

    // --- Rich text -------------------------------------------------------

    const fontOfRun = (r: InlineRun) => {
      if (r.code) return FONT.mono
      if (r.bold && r.italic) return FONT.boldItalic
      if (r.bold) return FONT.bold
      return r.italic ? FONT.italic : FONT.body
    }

    const drawRuns = (runs: InlineRun[], size: number, colour = INK) => {
      const pieces = runs.flatMap(splitScriptDigits).map(r => ({ ...r, text: r.code ? r.text.replace(/[^\x20-\x7e\n]/g, c => { missing.add(c); return '?' }) : t(r.text) })).filter(r => r.text)
      pieces.forEach((r, i) => {
        // pdfkit draws from the top of the line, so smaller text sits high unless it's moved: this
        // puts a subscript below the line's baseline and a superscript above it. The shift is
        // given as a negative distance down from that top edge.
        const script = r.script === 'sub' ? { baseline: -size * (FONT_ASCENT + 0.18) }
          : r.script === 'sup' ? { baseline: -size * (FONT_ASCENT - 0.34) }
          : {}
        doc.font(fontOfRun(r)).fontSize(r.script ? size * 0.72 : size).fillColor(r.link ? '#1D4ED8' : colour)
          .text(r.text, {
            continued: i < pieces.length - 1,
            lineGap: 2.5,
            underline: !!r.underline,
            strike: !!r.strike,
            ...(r.link ? { link: r.link } : { link: null }),
            ...script,
          } as never)
      })
    }

    const drawTable = (table: Extract<Block, { kind: 'table' }>, x: number) => {
      if (table.caption) para(table.caption, { size: 9, italic: true, colour: MUTED, after: 3 })
      const columns = columnCount(table.rows)
      const width = doc.page.width - PAGE.right - x
      const cellText = (c: TableCell) => t(plainScriptDigits(c.text)) || ' '
      const drawRows = (rows: TableCell[][]) => {
        doc.x = x
        doc.table({
          position: { x, y: doc.y },
          maxWidth: width,
          columnStyles: Array.from({ length: columns }, () => '*') as never,
          defaultStyle: { padding: TABLE_PADDING, border: 0.5, borderColor: LINE } as never,
          data: rows.map(row => row.map(c => ({
            text: cellText(c),
            colSpan: c.colSpan,
            rowSpan: c.rowSpan,
            font: { src: c.bold ? FONT.bold : FONT.body, size: TABLE_FONT_SIZE },
            textColor: INK,
            ...(c.header ? { backgroundColor: '#F1F5F9' } : {}),
          }))) as never,
        })
      }
      const rowHeight = (row: TableCell[]) => Math.max(...row.map(c => {
        doc.font(c.bold ? FONT.bold : FONT.body).fontSize(TABLE_FONT_SIZE)
        return doc.heightOfString(cellText(c), { width: (width / columns) * c.colSpan - TABLE_PADDING * 2 }) + TABLE_PADDING * 2
      }))

      // pdfkit silently drops whatever doesn't fit when a row is taller than a page, so such a row
      // goes in as several rows, its text carrying on in the next.
      const splitTallRow = (row: TableCell[], maxHeight: number): TableCell[][] => {
        if (rowHeight(row) <= maxHeight) return [row]
        const parts = row.map(c => {
          doc.font(c.bold ? FONT.bold : FONT.body).fontSize(TABLE_FONT_SIZE)
          const textWidth = (width / columns) * c.colSpan - TABLE_PADDING * 2
          const fits = (s: string) => doc.heightOfString(t(plainScriptDigits(s)) || ' ', { width: textWidth }) + TABLE_PADDING * 2 <= maxHeight
          const words = c.text.split(/(?<=\s)/)
          const chunks: string[] = []
          let from = 0
          while (from < words.length) {
            let low = from + 1
            let high = words.length
            while (low < high) {
              const mid = Math.ceil((low + high) / 2)
              if (fits(words.slice(from, mid).join(''))) low = mid
              else high = mid - 1
            }
            chunks.push(words.slice(from, low).join(''))
            from = low
          }
          return chunks
        })
        const count = Math.max(...parts.map(p => p.length))
        return Array.from({ length: count }, (_, i) => row.map((c, j) => ({ ...c, rowSpan: 1, text: parts[j]![i] ?? '' })))
      }

      ensureRoom(40)
      const fullPage = bottomY() - PAGE.top - 20
      const heightOf = (rows: TableCell[][]) => rows.reduce((h, row) => h + rowHeight(row), 0)
      const merged = tableGrid(table.rows, columns, true)
      const hasMergedRows = merged.some(row => row.some(c => c.rowSpan > 1))
      if (hasMergedRows && heightOf(merged) <= fullPage) {
        // pdfkit fails on a merged row crossing a page, so a table with them stays on one page.
        if (doc.y + heightOf(merged) > bottomY()) startPage()
        drawRows(merged)
      } else {
        // Each page's part of a long table is its own table, headed by the header rows. A table
        // too long to keep its merged rows together gives those up, never its text.
        const rows = hasMergedRows ? tableGrid(table.rows, columns, false) : merged
        const firstBody = rows.findIndex(row => !row.every(c => c.header))
        const header = firstBody > 0 ? rows.slice(0, firstBody) : []
        const headerHeight = heightOf(header)
        const maxRowHeight = fullPage - headerHeight
        const body = rows.slice(header.length).flatMap(row => splitTallRow(row, maxRowHeight))
        let part: TableCell[][] = [...header]
        let y = doc.y + headerHeight
        for (const row of body) {
          const h = rowHeight(row)
          if (part.length > header.length && y + h > bottomY()) {
            drawRows(part)
            startPage()
            part = [...header]
            y = doc.y + headerHeight
          }
          part.push(row)
          y += h
        }
        drawRows(part)
      }
      doc.x = x
      gap(8)
    }

    const simpleTable = (head: string[], rows: string[][]) => drawTable({
      kind: 'table',
      caption: null,
      rows: [
        head.map(text => ({ text, bold: true, header: true, colSpan: 1, rowSpan: 1 })),
        ...rows.map(row => row.map(text => ({ text, bold: false, header: false, colSpan: 1, rowSpan: 1 }))),
      ],
    }, left)

    const HEADING_SIZE: Record<number, number> = { 1: 13.5, 2: 13, 3: 11.5, 4: 10.5, 5: 10, 6: 10 }

    const drawBlocks = (blocks: Block[], x: number) => {
      for (const b of blocks) {
        doc.x = x
        switch (b.kind) {
          case 'heading': {
            const size = HEADING_SIZE[b.level] ?? 10
            ensureRoom(size * 4)
            doc.x = x
            gap(3)
            drawRuns(b.runs.map(r => ({ ...r, bold: true })), size)
            gap(4)
            break
          }
          case 'paragraph':
            ensureRoom(24)
            doc.x = x
            drawRuns(b.runs, 10)
            gap(6)
            break
          case 'pre':
            ensureRoom(24)
            doc.x = x
            doc.font(FONT.mono).fontSize(8.5).fillColor(INK).text(b.text.replace(/[^\x20-\x7e\n]/g, c => { missing.add(c); return '?' }), { lineGap: 1.5 })
            gap(6)
            break
          case 'list':
            b.items.forEach((item, i) => {
              ensureRoom(24)
              const marker = b.ordered ? `${b.start + i}.` : '•'
              const y = doc.y
              doc.font(FONT.body).fontSize(10).fillColor(INK).text(marker, x, y, { width: 16, lineBreak: false })
              doc.x = x + 18
              doc.y = y
              drawBlocks(item.length ? item : [{ kind: 'paragraph', runs: [{ text: ' ' }] }], x + 18)
              doc.y -= item.length ? 3 : 0
            })
            doc.x = x
            gap(4)
            break
          case 'quote': {
            const start = { page: currentPage(), y: doc.y }
            drawBlocks(b.blocks, x + 14)
            if (currentPage() === start.page) {
              doc.save().moveTo(x + 3, start.y).lineTo(x + 3, doc.y - 6).lineWidth(1.5).strokeColor(LINE).stroke().restore()
            }
            doc.x = x
            break
          }
          case 'table':
            drawTable(b, x)
            break
          case 'rule':
            ensureRoom(14)
            doc.save().moveTo(x, doc.y + 4).lineTo(doc.page.width - PAGE.right, doc.y + 4).lineWidth(0.5).strokeColor(LINE).stroke().restore()
            gap(12)
            break
        }
      }
      doc.x = x
    }

    // --- Title page ------------------------------------------------------

    startPage()
    gap(72)
    const programme = [input.project?.shortTitle, input.project?.name].filter(Boolean).join(' · ')
    if (programme) para(programme.toUpperCase(), { size: 9, colour: MUTED, bold: true, after: 10 })
    doc.font(FONT.bold).fontSize(24).fillColor(INK).text(t(input.document.title), { width: contentWidth() })
    gap(26)

    const titleRows: Array<[string, string]> = [
      ['Version', signed ? `${input.document.version} · Final` : input.document.version],
      ['Status', signed ? 'Signed' : `${input.document.statusLabel} — not signed`],
      ...(signed ? [['Signed', formatUtc(input.document.signedAt)] as [string, string]] : []),
      ...(input.project?.therapeuticArea ? [['Therapeutic area', input.project.therapeuticArea] as [string, string]] : []),
      ...(input.project?.phase ? [['Phase', input.project.phase] as [string, string]] : []),
      ...(input.documentHash ? [['Document hash (SHA-256)', input.documentHash] as [string, string]] : []),
      ['Document ID', input.document.id],
      ['Generated', `${formatUtc(input.generatedAt)} by ${input.generatedBy}`],
      ['Export ID', input.exportId],
    ]
    for (const [label, value] of titleRows) {
      const y = doc.y
      doc.font(FONT.body).fontSize(9.5).fillColor(MUTED).text(label, left, y, { width: 130 })
      doc.font(label === 'Version' || label === 'Status' ? FONT.bold : FONT.body).fontSize(label.startsWith('Document hash') ? 8.5 : 9.5).fillColor(INK)
        .text(t(value), left + 136, y, { width: contentWidth() - 136 })
      doc.x = left
      gap(6)
    }
    if (!signed) {
      gap(14)
      para('This copy is not a signed record. Its content can still change.', { bold: true, colour: '#B45309' })
    }
    const noticeAt = { page: currentPage() - 1, y: doc.y + 14 }

    // --- Contents --------------------------------------------------------

    const sections = orderSections(input.sections)
    const sectionLabel = (s: { number: string; title: string }) => `${s.number}. ${s.title}`
    const entries = [
      ...sections.map((s, i) => ({ label: sectionLabel(s), key: `section:${i}` })),
      { label: 'Appendix — Compliance Summary', key: 'appendix' },
      { label: 'Signature Page', key: 'signatures' },
    ]
    startPage()
    heading('Contents', 16)
    for (const e of entries) {
      ensureRoom(18)
      const y = doc.y
      doc.font(FONT.body).fontSize(10).fillColor(INK).text(t(e.label), left, y, { width: contentWidth() - 40 })
      const after = doc.y
      const page = labels.get(e.key)
      if (page) doc.text(String(page), left + contentWidth() - 34, y, { width: 34, align: 'right' })
      doc.x = left
      doc.y = after + 3
    }

    // --- Sections --------------------------------------------------------

    startPage()
    if (sections.length === 0) para('This document has no sections.', { italic: true, colour: MUTED })
    sections.forEach((s, i) => {
      if (i > 0) gap(10)
      heading(sectionLabel(s), 15, { label: `section:${i}`, outline: true })
      const blocks = htmlToBlocks(s.contentHtml)
      if (blocks.length === 0) para('No content recorded for this section.', { italic: true, colour: MUTED })
      else drawBlocks(blocks, left)
    })

    // --- Appendix: Compliance Summary -------------------------------------

    startPage()
    const c = input.compliance
    heading('Appendix — Compliance Summary', 15, { label: 'appendix', outline: true })
    para(`Generated from this document's input checklist${c.checklistTemplateVersion != null ? ` (template v${c.checklistTemplateVersion})` : ''}.`, { colour: MUTED })

    heading('Applicable regulatory frameworks', 12)
    if (c.frameworks.length === 0) para("No frameworks are recorded on this document's checklist.", { italic: true, colour: MUTED })
    else simpleTable(['Framework', 'Version', 'Jurisdiction', 'Reference'], c.frameworks.map(f => [
      f.name, f.version ?? '—', f.jurisdiction ?? '—', f.sourceUrl ?? (f.inRegistry ? '—' : 'Not in the framework registry'),
    ]))

    if (c.frameworks.length > 0) heading('Rules applied', 12)
    for (const f of c.frameworks) {
      heading(f.name, 10.5)
      simpleTable(['Rule', 'Outcome'], f.rules.map(r => [`${r.text}${r.mandatory ? '' : ' (recommended)'}`, RULE_OUTCOME[r.status] ?? r.status]))
    }

    heading('Waived Framework Mandatory items', 12)
    if (c.waivedMandatory.length === 0) para('None — no Framework Mandatory item (checklist item or ICH E3 section) was waived.', { colour: MUTED })
    else simpleTable(['Item', 'Framework', 'Waived by', 'Reason'], c.waivedMandatory.map(w => [
      w.text, w.framework, `${w.waivedBy ?? '—'}${w.waivedAt ? `\n${formatUtc(w.waivedAt)}` : ''}`, w.reason ?? '—',
    ]))

    heading('Removed Framework Mandatory items', 12)
    if (c.removedMandatory.length === 0) para('None — no Framework Mandatory checklist item was removed.', { colour: MUTED })
    else simpleTable(['Item', 'Framework', 'Removed by', 'Reason'], c.removedMandatory.map(r => [
      r.text, r.framework, `${r.removedBy ?? '—'}${r.removedAt ? `\n${formatUtc(r.removedAt)}` : ''}`, r.reason ?? '—',
    ]))

    // --- Signature page ---------------------------------------------------

    startPage()
    heading('Signature Page', 15, { label: 'signatures', outline: true })
    if (signed) {
      para(`${input.document.title} · ${input.document.version}`, { bold: true, after: 4 })
      para('Each person below signed this document electronically. Their name, the meaning of the signature and its date and time are the record of that signature (21 CFR Part 11 §11.50).', { after: 10 })
      const ordered = [...input.signatures].sort((a, b) => a.step - b.step)
      simpleTable(['Signed by', 'Role', 'Meaning', 'Signed', 'Signature ID'], ordered.map(s => [
        s.signerName, s.signerRole, MEANING[s.meaning] ?? s.meaning, formatUtc(s.timestampUtc), s.id,
      ]))
      const distinct = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => !!v))].join('; ')
      const atSigning = distinct(ordered.map(s => s.versionAtSigning))
      const auth = distinct(ordered.map(s => s.authMethod))
      const clock = distinct(ordered.map(s => s.timeSource))
      if (atSigning) para(`Version when signed: ${atSigning}`, { size: 9, after: 2 })
      if (auth) para(`How each signer was authenticated: ${auth}`, { size: 9, after: 2 })
      if (clock) para(`Time source: ${clock}`, { size: 9, after: 10 })
      para('Document hash (SHA-256) bound to these signatures:', { size: 9, after: 2 })
      para(input.documentHash ?? '—', { size: 8.5, after: 6 })
      para("Checked when this file was generated: the document's current content matches this hash.", { size: 9, colour: '#15803D', bold: true })
    } else {
      para('This document has not been signed, so this copy carries no signatures.', { bold: true, colour: '#B45309' })
    }

    // --- Every page: header, footer, watermark ------------------------------

    const range = doc.bufferedPageRange()
    pageCount = range.count

    const fitLine = (text: string, width: number) => {
      if (doc.widthOfString(text) <= width) return text
      let cut = text
      while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1)
      return `${cut}…`
    }
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i)
      const margins = doc.page.margins
      doc.page.margins = { top: 0, bottom: 0, left: margins.left, right: margins.right }
      const w = doc.page.width - PAGE.left - PAGE.right

      // The title page is its own header.
      if (i > 0) {
        doc.font(FONT.body).fontSize(8).fillColor(MUTED)
        const project = t(input.project?.shortTitle)
        const projectWidth = project ? Math.min(doc.widthOfString(project), w * 0.3) : 0
        doc.text(fitLine(`${t(input.document.title)} · ${input.document.version} · ${statusLine}`, w - projectWidth - 12), PAGE.left, 34, { lineBreak: false })
        if (project) doc.text(fitLine(project, projectWidth + 1), PAGE.left + w - projectWidth, 34, { lineBreak: false })
        doc.save().moveTo(PAGE.left, 47).lineTo(PAGE.left + w, 47).lineWidth(0.5).strokeColor(LINE).stroke().restore()
      }

      const footerY = doc.page.height - 40
      doc.font(FONT.body).fontSize(7.5).fillColor(FAINT)
        .text(`Generated ${formatUtc(input.generatedAt)} · Export ${input.exportId}`, PAGE.left, footerY, { lineBreak: false })
      doc.font(FONT.body).fontSize(8).fillColor(MUTED)
        .text(`Page ${i + 1} of ${range.count}`, PAGE.left, footerY, { width: w, align: 'right', lineBreak: false })

      // Listed last, once every character in the document has been seen.
      if (i === noticeAt.page && missing.size > 0) {
        // By code, since these are the very characters the font can't show.
        const shown = [...missing].slice(0, 12).map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(', ')
        const more = missing.size > 12 ? ` and ${missing.size - 12} more` : ''
        doc.font(FONT.bold).fontSize(9).fillColor('#B45309')
          .text(`Some characters in this document can't be drawn in this PDF and appear as ${MISSING_MARK} (${shown}${more}). The Final Document screen shows them correctly.`, PAGE.left, noticeAt.y, { width: w, lineGap: 2 })
      }

      if (!signed) {
        const cx = doc.page.width / 2
        const cy = doc.page.height / 2
        doc.save().rotate(-42, { origin: [cx, cy] }).opacity(0.13).font(FONT.bold).fontSize(52).fillColor('#475569')
        doc.text(DRAFT_WATERMARK, cx - doc.widthOfString(DRAFT_WATERMARK) / 2, cy - 26, { lineBreak: false })
        doc.restore()
      }
      doc.page.margins = margins
    }

    doc.flushPages()
    doc.end()
  })
}

/** Drawn twice: the first pass finds which page each section lands on, for the contents page. */
export async function renderFinalDocumentPdf(input: FinalPdfInput): Promise<FinalPdfResult> {
  const first = await renderOnce(input, new Map())
  const { pdf, pageCount, undrawableCharacters } = await renderOnce(input, first.labels)
  return { pdf, pageCount, undrawableCharacters }
}
