// Master Library — "Download PDF". The item's own text only: its title and body. No
// app details, provenance or status — those stay on screen. Built on the server so the
// browser gets a real file (no print dialog).
//
// pdfkit's built-in Times font covers Latin-1 plus the usual Windows-1252 punctuation.
// Anything outside that range (≥, →, CJK …) would print as junk, so a few common symbols
// are spelled out and the rest becomes "?" instead of corrupting the page.

import PDFDocument from 'pdfkit'

const SPELLED_OUT: Record<string, string> = {
  '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '−': '-', '×': 'x', ' ': ' ', ' ': ' ', ' ': ' ', '✓': 'v', '≠': '!=',
}
const WIN1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

export function pdfSafeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (SPELLED_OUT[ch] !== undefined) out += SPELLED_OUT[ch]
    else if (ch === '\n' || ch === '\t' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN1252_EXTRA.has(ch)) out += ch
    else if (code < 0x20) continue
    else out += '?'
  }
  return out
}

/** A file name the browser will accept: letters, digits, dash, underscore. */
export function pdfFileName(title: string): string {
  const slug = title.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80)
  return `${slug || 'library-item'}.pdf`
}

export function renderLibraryItemPdf(item: { title: string; body: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 57, bottom: 57, left: 51, right: 51 },   // 20 mm / 18 mm
      info: { Title: pdfSafeText(item.title), Author: 'Master Library' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Times-Bold').fontSize(18).fillColor('#000').text(pdfSafeText(item.title)).moveDown(0.8)
    doc.font('Times-Roman').fontSize(12).text(pdfSafeText(item.body), { lineGap: 3 })
    doc.end()
  })
}
