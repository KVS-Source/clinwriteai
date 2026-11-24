// One-off: render a curated markdown doc to a layout-friendly PDF using
// pdfkit (already in node_modules for the final-document PDF renderer).
// Handles H1 / H2 / bullets / horizontal rules / plain paragraphs and
// inline **bold** / *italic* / `code` segments.
//
//   node scripts/md-to-pdf.mjs <input.md> [output.pdf]

import { readFileSync, createWriteStream } from 'node:fs'
import { resolve, dirname, basename, extname } from 'node:path'
import PDFDocument from 'pdfkit'

const [inputArg, outputArg] = process.argv.slice(2)
if (!inputArg) {
  console.error('usage: node md-to-pdf.mjs <input.md> [output.pdf]')
  process.exit(1)
}
const inputPath  = resolve(inputArg)
const outputPath = outputArg
  ? resolve(outputArg)
  : resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + '.pdf')

const md = readFileSync(inputPath, 'utf8')

// Page geometry — US Letter minus 0.75" margins so figures/wide bullets
// don't crowd the edges.
const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: 54, left: 54, right: 54, bottom: 54 },
  info: {
    Title:    basename(inputPath, extname(inputPath)).replace(/[-_]/g, ' '),
    Producer: 'ClinWrite.AI docs tooling',
  },
})
doc.pipe(createWriteStream(outputPath))

// --- Style tokens -------------------------------------------------------

const PALETTE = {
  title:    '#0F172A',
  h2:       '#1E40AF',
  body:     '#1E293B',
  muted:    '#64748B',
  rule:     '#CBD5E1',
  codeBg:   '#F1F5F9',
  codeFg:   '#0F172A',
  bulletFg: '#2563EB',
}

const FONT = {
  body:       'Helvetica',
  bold:       'Helvetica-Bold',
  italic:     'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
  mono:       'Courier',
  monoBold:   'Courier-Bold',
}

// --- Inline markdown parser (bold / italic / code) ----------------------
//
// Returns an array of {text, bold, italic, code} runs. Deliberately
// permissive — unmatched markers are rendered as literal characters so a
// typo in the source doesn't blow the layout.

function parseInline(line) {
  const runs = []
  let i = 0
  const current = { bold: false, italic: false, code: false }
  let buf = ''
  const flush = () => { if (buf) { runs.push({ text: buf, ...current }); buf = '' } }

  while (i < line.length) {
    const ch  = line[i]
    const ch2 = line[i + 1]
    if (ch === '*' && ch2 === '*') { flush(); current.bold   = !current.bold;   i += 2; continue }
    if (ch === '`')               { flush(); current.code   = !current.code;   i += 1; continue }
    if (ch === '*' || ch === '_') { flush(); current.italic = !current.italic; i += 1; continue }
    buf += ch
    i += 1
  }
  flush()
  return runs
}

function fontFor(run) {
  if (run.code)               return FONT.mono
  if (run.bold && run.italic) return FONT.boldItalic
  if (run.bold)               return FONT.bold
  if (run.italic)             return FONT.italic
  return FONT.body
}

// --- Block renderers ----------------------------------------------------

function writeRuns(runs, { size, color, indent = 0, lineGap = 2 }) {
  const startX = doc.page.margins.left + indent
  const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - indent
  // Build a single continuous text run — pdfkit's `continued: true` wraps
  // automatically and preserves the font/colour per segment.
  const parts = runs.filter(r => r.text.length > 0)
  if (parts.length === 0) return

  doc.fillColor(color).fontSize(size)
  parts.forEach((run, idx) => {
    const last = idx === parts.length - 1
    doc.font(fontFor(run))
    if (run.code) {
      // Inline code: subtle grey background. pdfkit doesn't have a text
      // highlight, so we underline in a muted way to signal "this is code"
      // without inflating the line height.
      doc.fillColor(PALETTE.codeFg)
      doc.text(run.text, { continued: !last, lineGap, indent: idx === 0 ? 0 : undefined })
      doc.fillColor(color)
    } else {
      doc.text(run.text, { continued: !last, lineGap })
    }
  })
  doc.x = startX
}

function writeTitle(text) {
  doc.moveDown(0.3)
  doc.font(FONT.bold).fontSize(22).fillColor(PALETTE.title)
    .text(text, { lineGap: 4 })
  // Underline rule
  const y = doc.y + 2
  doc.strokeColor(PALETTE.h2).lineWidth(1.2)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.margins.left + 72, y)
    .stroke()
  doc.moveDown(0.8)
}

function writeH2(text) {
  doc.moveDown(0.6)
  doc.font(FONT.bold).fontSize(14).fillColor(PALETTE.h2)
    .text(text, { lineGap: 2 })
  doc.moveDown(0.25)
}

function writeParagraph(line) {
  if (line.trim().length === 0) { doc.moveDown(0.35); return }
  writeRuns(parseInline(line), { size: 10.5, color: PALETTE.body })
  doc.moveDown(0.25)
}

function writeBullet(line) {
  // Strip the leading "- "
  const content = line.replace(/^\s*-\s+/, '')
  const bulletX = doc.page.margins.left + 6
  const textX   = doc.page.margins.left + 18
  const startY  = doc.y

  // Bullet marker
  doc.font(FONT.bold).fontSize(11).fillColor(PALETTE.bulletFg)
    .text('•', bulletX, startY, { lineBreak: false })

  // Body — indent so the text aligns past the bullet
  doc.x = textX
  const indent = textX - doc.page.margins.left
  writeRuns(parseInline(content), { size: 10.5, color: PALETTE.body, indent, lineGap: 2 })
  doc.moveDown(0.15)
  doc.x = doc.page.margins.left
}

function writeHr() {
  doc.moveDown(0.5)
  const y = doc.y
  doc.strokeColor(PALETTE.rule).lineWidth(0.6)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke()
  doc.moveDown(0.5)
}

// --- Main walk ----------------------------------------------------------

const lines = md.split(/\r?\n/)
let i = 0
while (i < lines.length) {
  const line = lines[i]
  const trimmed = line.trim()

  if (trimmed.startsWith('# ')) {
    writeTitle(trimmed.slice(2))
  } else if (trimmed.startsWith('## ')) {
    writeH2(trimmed.slice(3))
  } else if (trimmed.startsWith('### ')) {
    doc.moveDown(0.3)
    doc.font(FONT.bold).fontSize(12).fillColor(PALETTE.h2).text(trimmed.slice(4))
    doc.moveDown(0.2)
  } else if (trimmed === '---') {
    writeHr()
  } else if (/^\s*-\s+/.test(line)) {
    writeBullet(line)
  } else if (trimmed.length === 0) {
    doc.moveDown(0.3)
  } else {
    writeParagraph(trimmed)
  }
  i += 1
}

// Footer — small muted byline on the final page so the reader can see
// what produced the PDF + when.
doc.moveDown(0.8)
doc.font(FONT.italic).fontSize(8).fillColor(PALETTE.muted)
  .text(`Generated from ${basename(inputPath)} · ${new Date().toISOString().slice(0, 10)}`,
    { align: 'right' })

doc.end()
doc.on('end', () => console.log(`wrote ${outputPath}`))
