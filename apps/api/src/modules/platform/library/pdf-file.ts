// The PDF of a Master Library entry: the file a PM uploaded (when it was a PDF), otherwise the entry's title
// and text rendered to a PDF. Used by the in-app View (GET /library/:id/pdf) and by the view behind a share
// link (GET /shared-library/:token/pdf), so both always show the same file.
//
// An entry pushed from a document is rendered from that document version's own sections (their HTML), so tables, lists
// and formatting come out as on the Final Document screen; the entry's `body` is only the flattened text, kept for
// search. If the source version can't be found, or drawing it fails, the flattened text is drawn instead.
//
// With a watermark (watermark.ts), every page carries the reader's email and the time. An uploaded PDF that
// can't be stamped (damaged or password-protected) is rebuilt from its text and stamped instead; only when it
// has no text either is it shown as uploaded, unstamped.

import type { FastifyInstance } from 'fastify'
import { renderLibraryDocumentPdf } from '../../clinical-writing/documents/final-pdf-renderer.js'
import { pdfFileName, renderLibraryItemPdf } from './pdf-renderer.js'
import { htmlToPlainText } from './plain-text.js'
import { watermarkPdf, type Watermark } from './watermark.js'

// Longest text the PDF will render (about 600 pages). Beyond it the request is refused rather than tying up memory.
export const PDF_MAX_CHARS = 2_000_000

/** The stored original of an uploaded document: its blob key and file name, from the entry's tags. */
export function uploadedOriginal(tags: string[]): { key: string; fileName: string } | null {
  const key = tags.find(t => t.startsWith('file:'))?.slice(5)
  const fileName = tags.find(t => t.startsWith('filename:'))?.slice(9)
  return key && fileName ? { key, fileName } : null
}

export type LibraryPdf =
  | { ok: true; body: Buffer; fileName: string; originalName: string; watermarked: boolean }
  | { ok: false; code: 413 | 422; error: string; message: string }

/** The source document's section HTML for an entry pushed from a document version, or null (an upload, a best practice,
 *  or a version that no longer exists). A signed version is never changed, so this is what was pushed. */
async function sourceSections(prisma: FastifyInstance['prisma'] | undefined, tags: string[]) {
  const documentId = tags.find(t => t.startsWith('fromdoc:'))?.slice(8)
  const versionNumber = tags.find(t => t.startsWith('docversion:'))?.slice(11)
  if (!prisma || !documentId || !versionNumber) return null
  const version = await prisma.documentVersion.findUnique({
    where: { documentId_versionNumber: { documentId, versionNumber } },
    select: { sections: { select: { sectionNumber: true, sectionTitle: true, contentHtml: true } } },
  })
  const sections = (version?.sections ?? []).map(s => ({ number: s.sectionNumber, title: s.sectionTitle, contentHtml: s.contentHtml }))
  return sections.some(s => htmlToPlainText(s.contentHtml)) ? sections : null
}

export async function libraryItemPdf(
  app: Pick<FastifyInstance, 'blob' | 'log'> & Partial<Pick<FastifyInstance, 'prisma'>>,
  row: { id: string; title: string; body: string; tags: string[] },
  opts: { watermark?: Watermark } = {},
): Promise<LibraryPdf> {
  const name = pdfFileName(row.title)
  // An uploaded PDF gives back the very file that was uploaded (a Word file is rebuilt from its text, below).
  const original = uploadedOriginal(row.tags)
  let unstampable: Buffer | null = null
  if (original && original.fileName.toLowerCase().endsWith('.pdf')) {
    let file: Buffer | null = null
    try {
      file = (await app.blob.get('documents', original.key)).body
    } catch (err) {
      app.log.warn({ err, id: row.id }, 'uploaded library PDF could not be read from storage — rebuilding it from the text')
    }
    if (file) {
      if (!opts.watermark) return { ok: true, body: file, fileName: name, originalName: original.fileName, watermarked: false }
      try {
        return { ok: true, body: await watermarkPdf(file, opts.watermark), fileName: name, originalName: original.fileName, watermarked: true }
      } catch (err) {
        app.log.warn({ err, id: row.id }, 'uploaded library PDF could not be watermarked — rebuilding it from the text')
        unstampable = file
      }
    }
  }
  if (!row.body.trim()) {
    if (unstampable) return { ok: true, body: unstampable, fileName: name, originalName: original!.fileName, watermarked: false }
    return { ok: false, code: 422, error: 'empty', message: 'This item has no text to download.' }
  }
  if (row.body.length > PDF_MAX_CHARS) {
    return { ok: false, code: 413, error: 'too_large', message: 'This item is too long to download as a PDF.' }
  }
  let pdf: Buffer | null = null
  try {
    const sections = await sourceSections(app.prisma, row.tags)
    if (sections) pdf = (await renderLibraryDocumentPdf({ title: row.title, sections })).pdf
  } catch (err) {
    app.log.warn({ err, id: row.id }, 'library PDF could not be drawn from the source document — drawing the flattened text instead')
  }
  pdf ??= await renderLibraryItemPdf({ title: row.title, body: row.body })
  if (!opts.watermark) return { ok: true, body: pdf, fileName: name, originalName: name, watermarked: false }
  return { ok: true, body: await watermarkPdf(pdf, opts.watermark), fileName: name, originalName: name, watermarked: true }
}
