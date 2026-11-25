// AI drafting has no page limit on its sources: past 100 PDF pages the longest files go as text, with no page left out.

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildSourceBlocks, inputUsage, SourcesTooLongError } from '../../../../../worker/src/jobs/source-blocks.js'

const MODEL = 'claude-sonnet-4-6'
async function pdf(pages: number, text: (n: number) => string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= pages; n++) doc.addPage().drawText(text(n), { x: 20, y: 700, size: 2, lineHeight: 4, font })
  return Buffer.from(await doc.save())
}
const body = (n: number) => `Unique protocol sentence number ${n} of this source.`

describe('buildSourceBlocks', () => {
  it('short sources are sent as PDFs, unchanged and uncached', async () => {
    const bytes = await pdf(5, body)
    const r = await buildSourceBlocks([{ title: 'A', bytes }], MODEL)
    expect(r).toMatchObject({ cached: false, asText: [], pages: 5 })
    expect(r.blocks).toEqual([{ type: 'document', title: 'A', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }])
  })

  it('more than 600 pages: every page of the long ones is there as text, the short one stays a PDF', async () => {
    const r = await buildSourceBlocks([
      { title: 'Long 1', bytes: await pdf(400, body) },
      { title: 'Short', bytes: await pdf(4, body) },
      { title: 'Long 2', bytes: await pdf(322, body) },
    ], MODEL)
    expect(r.pages).toBe(726)
    expect(r.blocks.map(b => [b.title, b.source.type])).toEqual([['Long 1', 'text'], ['Short', 'base64'], ['Long 2', 'text']])
    for (const n of [1, 200, 400]) expect(r.blocks[0]!.source.data).toContain(`[Page ${n}]\n${body(n)}`)
    expect(r.blocks[0]!.source.data.match(/\[Page \d+\]/g)).toHaveLength(400)
    expect(r.blocks.map(b => b.cache_control?.type)).toEqual([undefined, undefined, 'ephemeral'])
  }, 60_000)

  it('a page without text is still sent, as a PDF page', async () => {
    const r = await buildSourceBlocks([{ title: 'L', bytes: await pdf(120, n => (n === 7 ? '' : body(n))) }], MODEL)
    expect(r.asText).toEqual([{ title: 'L', pages: 120, pdfPages: 1 }])
    expect(r.blocks[1]!.title).toBe('L (its pages 7)')
    expect((await PDFDocument.load(Buffer.from(r.blocks[1]!.source.data, 'base64'))).getPageCount()).toBe(1)
  }, 60_000)

  it('an unreadable PDF is passed on as it is', async () => {
    const r = await buildSourceBlocks([{ title: 'X', bytes: Buffer.from('not a pdf') }], MODEL)
    expect(r.blocks).toHaveLength(1)
  })

  it('what cannot be sent in any form says why', async () => {
    const scanned = await pdf(601, () => '')
    await expect(buildSourceBlocks([{ title: 'S', bytes: scanned }], MODEL)).rejects.toThrow(SourcesTooLongError)
    const dense = await pdf(150, () => `${'word '.repeat(60)}
`.repeat(25))
    await expect(buildSourceBlocks([{ title: 'D', bytes: dense }], 'claude-haiku-4-5')).rejects.toThrow(/more than claude-haiku-4-5 can read/)
  }, 60_000)

  it('counts cached input as input', () => {
    expect(inputUsage({ input_tokens: 5, cache_creation_input_tokens: 20, cache_read_input_tokens: 100 })).toEqual({ inputTokens: 125, cachedTokens: 100 })
    expect(inputUsage(undefined)).toEqual({ inputTokens: 0, cachedTokens: 0 })
  })
})
