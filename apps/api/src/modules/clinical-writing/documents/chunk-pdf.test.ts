import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { chunkPdfToFit } from './chunk-pdf.js'

async function makePdf(pageCount: number, fillKbPerPage = 0): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200])
    page.drawText(`Page ${i + 1}`, { x: 50, y: 100, size: 14 })
    // Pad the stream so pages have measurable bytes — pdf-lib compresses
    // identical content, so inject per-page random noise to foil that.
    if (fillKbPerPage > 0) {
      const filler = Array.from({ length: fillKbPerPage * 50 }, () =>
        String.fromCharCode(32 + Math.floor(Math.random() * 95)),
      ).join('')
      page.drawText(filler, { x: 10, y: 10, size: 1, maxWidth: 180 })
    }
  }
  return Buffer.from(await doc.save())
}

describe('chunkPdfToFit', () => {
  it('returns null for an empty buffer', async () => {
    const r = await chunkPdfToFit(Buffer.alloc(0), { maxBytes: 1024, maxPages: 10 })
    expect(r).toBeNull()
  })

  it('returns null for a non-PDF buffer', async () => {
    const r = await chunkPdfToFit(Buffer.from('nope not a pdf'), { maxBytes: 1024, maxPages: 10 })
    expect(r).toBeNull()
  })

  it('fast path — PDF already under both caps is returned as-is', async () => {
    const small = await makePdf(3)
    const r = await chunkPdfToFit(small, { maxBytes: 1_000_000, maxPages: 10 })
    expect(r).not.toBeNull()
    expect(r!.data).toBe(small)
    expect(r!.pagesIncluded).toBe(3)
    expect(r!.pagesOmitted).toBe(0)
    expect(r!.note).toContain('no chunking needed')
  })

  it('truncates to the page cap when a PDF has too many pages', async () => {
    const big = await makePdf(20)
    const r = await chunkPdfToFit(big, { maxBytes: 1_000_000, maxPages: 5 })
    expect(r).not.toBeNull()
    expect(r!.pagesIncluded).toBeLessThanOrEqual(5)
    expect(r!.pagesOmitted).toBe(20 - r!.pagesIncluded)
    expect(r!.originalPages).toBe(20)
    expect(r!.note.toLowerCase()).toContain('truncated')
  })

  it('reports original and final sizes', async () => {
    const big = await makePdf(10, 10)
    const r = await chunkPdfToFit(big, { maxBytes: 1_000_000, maxPages: 3 })
    expect(r).not.toBeNull()
    expect(r!.originalBytes).toBe(big.length)
    expect(r!.pagesIncluded).toBeLessThanOrEqual(3)
    expect(r!.bytes).toBeLessThanOrEqual(1_000_000)
    expect(r!.originalPages).toBe(10)
  })
})
