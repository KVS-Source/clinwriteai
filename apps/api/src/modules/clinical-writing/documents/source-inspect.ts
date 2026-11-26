// Whether the AI drafter can read an uploaded source file, worked out once from the file's bytes and kept in the
// upload's `classification` JSON (as `inspection`). The New Document source check reads it; files uploaded before
// this existed are inspected the first time they are checked.
//
// The drafter reads PDFs (pages without text go to the model as images), Word .docx and plain-text files.
// PowerPoint, Excel, old .doc and image files are not read, so they can't supply anything to a draft.

import { createHash } from 'node:crypto'
import { fileExtension } from '../../platform/uploads/source-files.js'

/** Pages with less text than this count as scans (the drafter uses the same threshold). */
const MIN_PAGE_CHARS = 20
/** The most pages without text the model takes at once (Claude's PDF limit). */
export const MAX_SCANNED_PAGES = 600

export type SourceKind = 'pdf' | 'word' | 'text' | 'other'

export interface SourceInspection {
  sha256:      string
  kind:        SourceKind
  /** PDF only. */
  pages:       number | null
  /** PDF pages without any text (scans, figures). */
  scannedPages: number | null
  chars:       number
  /** The drafter can read it. */
  usable:      boolean
  /** Why it can't be read, or what is limited about it; null when nothing is. */
  problem:     string | null
}

const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'md', 'json'])

export function sourceKind(fileName: string, contentType: string | null): SourceKind {
  const ext = fileExtension(fileName)
  const type = (contentType ?? '').toLowerCase()
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf'
  if (ext === 'docx') return 'word'
  if (TEXT_EXTENSIONS.has(ext) || type.startsWith('text/')) return 'text'
  return 'other'
}

export const sha256Of = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

export async function inspectSource(buffer: Buffer, fileName: string, contentType: string | null): Promise<SourceInspection> {
  const sha256 = sha256Of(buffer)
  const kind = sourceKind(fileName, contentType)
  const base = { sha256, kind, pages: null, scannedPages: null, chars: 0 }

  if (kind === 'pdf') {
    let pages: string[]
    try {
      const { PDFParse } = await import('pdf-parse') as unknown as {
        PDFParse: new (opts: { data: Uint8Array }) => {
          getText(opts: { pageJoiner: string }): Promise<{ pages: Array<{ text: string }> }>
          destroy(): Promise<void>
        }
      }
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      pages = (await parser.getText({ pageJoiner: '' }).finally(() => parser.destroy())).pages.map(p => (p.text ?? '').trim())
    } catch {
      return { ...base, usable: false, problem: 'The PDF could not be opened. It may be damaged or password-protected.' }
    }
    const scanned = pages.filter(p => p.length < MIN_PAGE_CHARS).length
    const chars = pages.reduce((n, p) => n + p.length, 0)
    const result = { ...base, pages: pages.length, scannedPages: scanned, chars }
    if (pages.length === 0) return { ...result, usable: false, problem: 'The PDF has no pages.' }
    if (scanned > MAX_SCANNED_PAGES) {
      return { ...result, usable: false, problem: `${scanned} pages are scans with no text; the AI can read at most ${MAX_SCANNED_PAGES}. Upload a searchable (text) PDF.` }
    }
    if (scanned === pages.length) return { ...result, usable: true, problem: 'Every page is a scan with no text. The AI reads it as images, so check its figures carefully.' }
    if (scanned > 0) return { ...result, usable: true, problem: `${scanned} of ${pages.length} pages have no text (scans or figures). The AI reads them as images.` }
    return { ...result, usable: true, problem: null }
  }

  if (kind === 'word' || kind === 'text') {
    let text = ''
    try {
      if (kind === 'word') {
        const mammoth = await import('mammoth')
        text = ((await mammoth.extractRawText({ buffer })).value ?? '').trim()
      } else {
        text = buffer.toString('utf8').trim()
      }
    } catch {
      return { ...base, usable: false, problem: 'The file could not be opened. It may be damaged or password-protected.' }
    }
    if (text.length < MIN_PAGE_CHARS) return { ...base, chars: text.length, usable: false, problem: 'The file has no readable text.' }
    return { ...base, chars: text.length, usable: true, problem: null }
  }

  const ext = fileExtension(fileName)
  return {
    ...base,
    usable: false,
    problem: ext === 'doc'
      ? 'Old Word (.doc) files can’t be read by the AI. Save it as .docx or PDF and upload that.'
      : 'The AI can’t read PowerPoint, Excel or image files. Save it as PDF and upload that.',
  }
}
