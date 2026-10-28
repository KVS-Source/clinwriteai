// Chunk an oversized PDF down to the first N pages that fit under a
// byte / page budget — so a 60MB 300-page scanned Protocol becomes a
// smaller first-N-pages PDF the vision model can actually read.
//
// Strategy:
//   1. If the PDF already fits (bytes AND pages) → return as-is
//   2. Pick a candidate page count that respects the page cap
//   3. Build a new PDF with just those pages
//   4. If still over the byte cap, drop more pages (geometric-ish)
//   5. If a single page is still too big → return null (give up; the
//      caller surfaces the drop with a note)
//
// Pure JS via pdf-lib — no native deps, works on every Node platform.
// Does NOT re-encode page content; stripping metadata and image
// compression are left to the model's downstream processing.

import { PDFDocument } from 'pdf-lib'

export interface ChunkOptions {
  /** Max bytes for the result. */
  maxBytes: number
  /** Max pages for the result. */
  maxPages: number
}

export interface ChunkResult {
  /** The chunked PDF bytes. */
  data: Buffer
  /** Pages included (always 1..pagesIncluded of the original). */
  pagesIncluded: number
  /** Pages omitted. */
  pagesOmitted: number
  /** Original full page count. */
  originalPages: number
  /** Original byte size. */
  originalBytes: number
  /** Final byte size after chunking. */
  bytes: number
  /** Human-readable note describing what was done. */
  note: string
}

export async function chunkPdfToFit(
  original: Buffer,
  opts: ChunkOptions,
): Promise<ChunkResult | null> {
  if (original.length === 0) return null

  let src: PDFDocument
  try {
    src = await PDFDocument.load(original, { ignoreEncryption: true })
  } catch {
    return null
  }

  const originalPages = src.getPageCount()
  if (originalPages === 0) return null

  // Fast path — fits as-is.
  if (original.length <= opts.maxBytes && originalPages <= opts.maxPages) {
    return {
      data: original,
      pagesIncluded: originalPages,
      pagesOmitted: 0,
      originalPages,
      originalBytes: original.length,
      bytes: original.length,
      note: 'no chunking needed',
    }
  }

  // Candidate page count: min of the page cap and (pages × byte-ratio).
  // Byte ratio = maxBytes / originalBytes, so if the file is 2× cap we
  // start at half the pages. Scales conservatively from there.
  const byteRatio = opts.maxBytes / Math.max(original.length, 1)
  let candidatePages = Math.min(
    opts.maxPages,
    Math.max(1, Math.floor(originalPages * byteRatio)),
  )

  // Loop: build a PDF with candidatePages, measure, shrink if still too big.
  // Capped at 6 iterations — each halves the candidate on overshoot which
  // settles any realistic file in <6 rounds.
  for (let attempt = 0; attempt < 6; attempt++) {
    const copy = await PDFDocument.create()
    const indices = Array.from({ length: candidatePages }, (_, i) => i)
    const pages = await copy.copyPages(src, indices)
    for (const p of pages) copy.addPage(p)
    const bytes = Buffer.from(await copy.save())

    if (bytes.length <= opts.maxBytes) {
      const pagesOmitted = originalPages - candidatePages
      return {
        data: bytes,
        pagesIncluded: candidatePages,
        pagesOmitted,
        originalPages,
        originalBytes: original.length,
        bytes: bytes.length,
        note: pagesOmitted === 0
          ? `chunked to ${candidatePages} pages (${originalPages} total)`
          : `truncated to first ${candidatePages} of ${originalPages} pages`,
      }
    }

    // Still too big — try with fewer pages. Half, floor at 1.
    if (candidatePages <= 1) return null
    candidatePages = Math.max(1, Math.floor(candidatePages / 2))
  }

  return null
}
