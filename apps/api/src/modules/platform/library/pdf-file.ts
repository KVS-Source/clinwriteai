// The PDF of a Master Library entry: the file a PM uploaded (when it was a PDF), otherwise the entry's title
// and text rendered to a PDF. Used by the in-app View (GET /library/:id/pdf) and by the view behind a share
// link (GET /shared-library/:token/pdf), so both always show the same file.
//
// With a watermark (watermark.ts), every page carries the reader's email and the time. An uploaded PDF that
// can't be stamped (damaged or password-protected) is rebuilt from its text and stamped instead; only when it
// has no text either is it shown as uploaded, unstamped.

import type { FastifyInstance } from 'fastify'
import { pdfFileName, renderLibraryItemPdf } from './pdf-renderer.js'
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

export async function libraryItemPdf(
  app: Pick<FastifyInstance, 'blob' | 'log'>,
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
  const pdf = await renderLibraryItemPdf({ title: row.title, body: row.body })
  if (!opts.watermark) return { ok: true, body: pdf, fileName: name, originalName: name, watermarked: false }
  return { ok: true, body: await watermarkPdf(pdf, opts.watermark), fileName: name, originalName: name, watermarked: true }
}
