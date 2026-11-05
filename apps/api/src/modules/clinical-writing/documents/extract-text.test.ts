import { describe, expect, it } from 'vitest'
import { extractTextFromBlob } from './extract-text.js'

const txt = (s: string) => Buffer.from(s, 'utf8')

describe('extractTextFromBlob — text-like types', () => {
  it('decodes text/plain as UTF-8', async () => {
    const r = await extractTextFromBlob(txt('hello world'), 'text/plain')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('hello world')
    expect(r.reason).toBe('')
  })

  it('decodes text/markdown', async () => {
    const r = await extractTextFromBlob(txt('# Heading\n\nBody'), 'text/markdown')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('# Heading')
  })

  it('decodes application/json', async () => {
    const r = await extractTextFromBlob(txt('{"a":1}'), 'application/json')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('{"a":1}')
  })

  it('truncates at maxChars and reports the full size in reason', async () => {
    const big = 'x'.repeat(1000)
    const r = await extractTextFromBlob(txt(big), 'text/plain', { maxChars: 100 })
    expect(r.ok).toBe(true)
    expect(r.text).toHaveLength(100)
    expect(r.reason).toContain('truncated to 100 chars')
    expect(r.reason).toContain('1000')
    expect(r.returned).toBe(100)
    expect(r.bytes).toBe(1000)
  })
})

describe('extractTextFromBlob — unknown / unsupported', () => {
  it('returns a reason for an unsupported content type', async () => {
    const r = await extractTextFromBlob(txt('binary bytes'), 'image/png')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('')
    expect(r.reason).toContain('unsupported content-type')
    expect(r.reason).toContain('image/png')
  })

  it('handles null content-type gracefully', async () => {
    const r = await extractTextFromBlob(txt('something'), null)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('unknown')
  })

  it('handles bogus PDF bytes without throwing', async () => {
    // Not a real PDF — pdf-parse rejects it; we want graceful fail, not a 500.
    const r = await extractTextFromBlob(txt('not a pdf at all'), 'application/pdf')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('')
    expect(r.reason).toContain('PDF')
  })
})

describe('extractTextFromBlob — real PDFs', () => {
  // A small PDF, with a text layer when given lines and blank (like a scan) when not.
  function pdfOf(pages: string[][]): Buffer {
    const content = (lines: string[]) => (lines.length ? `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map(l => `(${l}) Tj T*`).join(' ')} ET` : '')
    const pageIds = pages.map((_, i) => 3 + i * 2)
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      ...pages.flatMap((lines, i) => {
        const stream = content(lines)
        return [
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageIds[i]! + 1} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`,
          `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        ]
      }),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = body.length
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(body, 'latin1')
  }

  it('reads the text of every page', async () => {
    const r = await extractTextFromBlob(pdfOf([['Statistical Analysis Plan'], ['Version 2.1']]), 'application/pdf')
    expect(r.reason).toBe('')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('Statistical Analysis Plan')
    expect(r.text).toContain('Version 2.1')
  })

  it('adds no page markers of its own', async () => {
    const r = await extractTextFromBlob(pdfOf([['First'], ['Second']]), 'application/pdf')
    expect(r.text).not.toMatch(/\d+ of \d+/)
  })

  it('caps long text', async () => {
    const r = await extractTextFromBlob(pdfOf([['Statistical Analysis Plan']]), 'application/pdf', { maxChars: 11 })
    expect(r.text).toBe('Statistical')
    expect(r.reason).toContain('truncated')
  })

  it('reports a PDF with no text layer as such, which is what sends a scan to AI Chat as an attachment', async () => {
    const r = await extractTextFromBlob(pdfOf([[], [], []]), 'application/pdf')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('')
    expect(r.reason).toContain('no extractable text')
  })
})
