// The PDF of a Master Library entry. An entry pushed from a document is drawn from that document version's sections
// (tables and formatting kept, as on the Final Document screen) and nothing else is added: no title page, contents,
// compliance appendix or signature page. Anything else — or a source that can't be read — is drawn from the flattened
// text, as before.

import { describe, expect, it, vi } from 'vitest'
import { extractTextFromBlob } from '../../clinical-writing/documents/extract-text.js'
import { libraryItemPdf } from './pdf-file.js'
import { sharedWatermark } from './watermark.js'

const textOf = async (pdf: Buffer) => (await extractTextFromBlob(pdf, 'application/pdf', { maxChars: 2_000_000 })).text

const TABLE = '<table><tr><th>Document metadata</th><th>Enter information</th></tr><tr><td>Full study title</td><td>[Information Required]</td></tr></table>'
const sections = [
  { sectionNumber: 'i', sectionTitle: 'Title page', contentHtml: `<p>CLINICAL STUDY PROTOCOL</p>${TABLE}` },
  { sectionNumber: '1', sectionTitle: 'Protocol Summary', contentHtml: '<p>Summary text.</p>' },
]
const row = {
  id: 'L1', title: 'Cipla Protocol', body: 'i Title page\nCLINICAL STUDY PROTOCOL\n\nDocument metadata\n\nEnter information',
  tags: ['type:document', 'fromdoc:D1', 'docversion:v1.0'],
}
const log = { warn: vi.fn() }
const blob = { get: vi.fn() }
const appWith = (findUnique: ReturnType<typeof vi.fn>) => ({ log, blob, prisma: { documentVersion: { findUnique } } }) as never

describe('libraryItemPdf — an entry pushed from a document', () => {
  it('draws the source version\'s sections, keeping the table, with only the title and the sections', async () => {
    const findUnique = vi.fn(async () => ({ sections }))
    const res = await libraryItemPdf(appWith(findUnique), row)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId_versionNumber: { documentId: 'D1', versionNumber: 'v1.0' } } }))
    const text = await textOf(res.body)
    expect(text).toContain('Cipla Protocol')
    expect(text).toContain('Title page')
    expect(text).toContain('Full study title')
    expect(text).toContain('[Information Required]')
    expect(text).not.toMatch(/Compliance Summary|Signature Page|DRAFT . NOT SIGNED|Export ID/)
  })

  it('still carries the reader\'s watermark', async () => {
    const res = await libraryItemPdf(appWith(vi.fn(async () => ({ sections }))), row, { watermark: sharedWatermark('ceo@example.com', new Date('2026-11-16T14:05:00Z')) })
    if (!res.ok) throw new Error('expected a PDF')
    expect(res.watermarked).toBe(true)
    expect(await textOf(res.body)).toContain('ceo@example.com')
  })

  it('falls back to the flattened text when the source version is gone, has no text, or the entry has no source', async () => {
    for (const app of [
      appWith(vi.fn(async () => null)),
      appWith(vi.fn(async () => ({ sections: [{ sectionNumber: '1', sectionTitle: 'Empty', contentHtml: '<p></p>' }] }))),
    ]) {
      const res = await libraryItemPdf(app, row)
      if (!res.ok) throw new Error('expected a PDF')
      expect(await textOf(res.body)).toContain('Enter information')
    }
    const findUnique = vi.fn()
    const res = await libraryItemPdf(appWith(findUnique), { ...row, tags: ['type:document'] })
    if (!res.ok) throw new Error('expected a PDF')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('falls back to the flattened text when drawing the source fails, and says so in the log', async () => {
    const res = await libraryItemPdf(appWith(vi.fn(async () => { throw new Error('db down') })), row)
    if (!res.ok) throw new Error('expected a PDF')
    expect(await textOf(res.body)).toContain('Document metadata')
    expect(log.warn).toHaveBeenCalled()
  })
})
