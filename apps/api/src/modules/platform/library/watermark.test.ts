import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { extractTextFromBlob } from '../../clinical-writing/documents/extract-text.js'
import { libraryItemPdf } from './pdf-file.js'
import { sharedWatermark, supersededBanner, viewerWatermark, watermarkPdf, watermarkTime } from './watermark.js'

async function pdfWithPages(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([595, 842]).drawText(`Page body ${i + 1}`, { x: 50, y: 750, size: 12 })
  return Buffer.from(await doc.save())
}
const textOf = async (pdf: Buffer) => {
  const r = await extractTextFromBlob(pdf, 'application/pdf')
  return r.ok ? r.text : ''
}
const AT = new Date('2026-11-16T09:05:00Z')

describe('watermark text', () => {
  it('names the reader and the time, in UTC', () => {
    expect(watermarkTime(AT)).toBe('16 Nov 2026 09:05 UTC')
    expect(sharedWatermark('ceo@acme.com', AT)).toEqual({
      main: 'ceo@acme.com - 16 Nov 2026 09:05 UTC',
      footer: 'Shared with ceo@acme.com on 16 Nov 2026 09:05 UTC via ClinWrite. Confidential - do not copy or forward.',
    })
    expect(viewerWatermark('pm@x.io', AT).footer).toMatch(/^Viewed by pm@x\.io on 16 Nov 2026 09:05 UTC/)
  })
})

describe('watermarkPdf', () => {
  it('stamps every page and keeps the page count and the original text', async () => {
    const out = await watermarkPdf(await pdfWithPages(3), sharedWatermark('ceo@acme.com', AT))
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3)
    const text = await textOf(out)
    expect(text).toContain('Page body 3')
    expect(text).toContain('ceo@acme.com - 16 Nov 2026 09:05 UTC')
    expect(text.match(/Shared with ceo@acme\.com/g)?.length).toBe(3)        // the foot line, once per page
  })
  it('copes with characters the standard PDF font lacks', async () => {
    const out = await watermarkPdf(await pdfWithPages(1), sharedWatermark('名前@例え.jp', AT))
    expect(await textOf(out)).toContain('??@??.jp')
  })
  it('throws on a file it can\'t read', async () => {
    await expect(watermarkPdf(Buffer.from('%PDF-1.4 not really'), sharedWatermark('a@b.c', AT))).rejects.toThrow()
  })
})

describe('libraryItemPdf with a watermark', () => {
  const log = { warn: vi.fn() }
  const row = (over: Partial<{ body: string; tags: string[] }> = {}) => ({ id: 'l1', title: 'CSR', body: 'Body text.', tags: [] as string[], ...over })
  const upload = ['file:library/t1/a.pdf', 'filename:Report.pdf']

  it('stamps an uploaded PDF', async () => {
    const app = { blob: { get: vi.fn(async () => ({ body: await pdfWithPages(2) })) }, log } as never
    const pdf = await libraryItemPdf(app, row({ tags: upload }), { watermark: sharedWatermark('ceo@acme.com', AT) })
    expect(pdf).toMatchObject({ ok: true, watermarked: true, originalName: 'Report.pdf' })
    if (pdf.ok) expect(await textOf(pdf.body)).toContain('ceo@acme.com')
  })
  it('rebuilds an upload it can\'t stamp from its text, and stamps that', async () => {
    const app = { blob: { get: vi.fn(async () => ({ body: Buffer.from('%PDF-1.4 broken') })) }, log } as never
    const pdf = await libraryItemPdf(app, row({ tags: upload }), { watermark: sharedWatermark('ceo@acme.com', AT) })
    expect(pdf).toMatchObject({ ok: true, watermarked: true })
    if (pdf.ok) expect(await textOf(pdf.body)).toContain('Body text.')
  })
  it('shows an unstampable upload with no text as it is, rather than nothing', async () => {
    const broken = Buffer.from('%PDF-1.4 broken')
    const app = { blob: { get: vi.fn(async () => ({ body: broken })) }, log } as never
    const pdf = await libraryItemPdf(app, row({ tags: upload, body: '' }), { watermark: sharedWatermark('ceo@acme.com', AT) })
    expect(pdf).toMatchObject({ ok: true, watermarked: false })
    if (pdf.ok) expect(pdf.body.equals(broken)).toBe(true)
  })
  it('stamps a document rendered from its text', async () => {
    const app = { blob: { get: vi.fn() }, log } as never
    const pdf = await libraryItemPdf(app, row(), { watermark: viewerWatermark('pm@x.io', AT) })
    expect(pdf).toMatchObject({ ok: true, watermarked: true })
    if (pdf.ok) expect(await textOf(pdf.body)).toContain('Viewed by pm@x.io')
  })

  it('an earlier version carries the SUPERSEDED line on every page as well', async () => {
    const app = { blob: { get: vi.fn() }, log } as never
    const pdf = await libraryItemPdf(app, row(), { watermark: viewerWatermark('pm@x.io', AT, supersededBanner('v2.0')) })
    expect(pdf.ok).toBe(true)
    if (pdf.ok) expect(await textOf(pdf.body)).toContain('SUPERSEDED - replaced by v2.0')
  })
})
