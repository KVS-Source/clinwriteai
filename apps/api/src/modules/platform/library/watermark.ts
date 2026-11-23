// A per-reader watermark on a Master Library PDF: the reader's email and the time, faint and diagonal across
// every page, plus a short line at the foot of each page. It doesn't stop a screenshot or a photo of the screen;
// it makes a copy that leaks traceable to the person it was shown to.
//
// Applied on the way out (GET /library/:id/pdf and GET /shared-library/:token/pdf); the stored file is never
// changed.

import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export interface Watermark {
  /** Repeated diagonally across the page, e.g. "ceo@example.com - 16 Nov 2026 14:05 UTC". */
  main: string
  /** One small line at the foot of every page. */
  footer: string
  /** A bold red line at the top of every page — an earlier, superseded version (SME decision, 2026-11-24). */
  banner?: string
}

/** The banner for an earlier version of a document that a later one replaced. */
export const supersededBanner = (replacedBy: string | null) =>
  `SUPERSEDED${replacedBy ? ` - replaced by ${replacedBy}` : ''}. Earlier version, for reference only.`

// The standard PDF fonts only carry Latin-1 ("WinAnsi"); anything else would make pdf-lib throw.
const winAnsi = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function watermarkTime(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())} UTC`
}

/** The watermark for someone reading through a share link (no account). */
export function sharedWatermark(email: string, at = new Date()): Watermark {
  const when = watermarkTime(at)
  return {
    main: `${email} - ${when}`,
    footer: `Shared with ${email} on ${when} via ClinWrite. Confidential - do not copy or forward.`,
  }
}

/** The watermark for a signed-in user reading in the app (View). `banner` marks a superseded version. */
export function viewerWatermark(email: string, at = new Date(), banner?: string): Watermark {
  const when = watermarkTime(at)
  return {
    main: `${email} - ${when}`,
    footer: `Viewed by ${email} on ${when} in ClinWrite. Confidential - do not copy or forward.`,
    ...(banner && { banner }),
  }
}

/** Stamps every page. Throws when the file can't be read (e.g. a damaged or encrypted upload). */
export async function watermarkPdf(pdf: Buffer, mark: Watermark): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const main = winAnsi(mark.main)
  const footer = winAnsi(mark.footer)
  const grey = rgb(0.45, 0.47, 0.52)
  const banner = mark.banner ? winAnsi(mark.banner) : null
  const bold = banner ? await doc.embedFont(StandardFonts.HelveticaBold) : null

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // Diagonal tiles, sized to the page so a small page still gets several and a large one isn't cluttered.
    const size = Math.max(10, Math.min(16, width / 40))
    const textWidth = font.widthOfTextAtSize(main, size)
    const stepX = textWidth + size * 6
    const stepY = size * 9
    for (let y = -height; y < height * 1.5; y += stepY) {
      for (let x = -width; x < width * 1.5; x += stepX) {
        page.drawText(main, { x, y, size, font, color: grey, opacity: 0.13, rotate: degrees(30) })
      }
    }
    const footSize = Math.max(6, Math.min(8, width / 75))
    const footText = font.widthOfTextAtSize(footer, footSize) > width - 24
      ? footer.slice(0, Math.floor(footer.length * (width - 24) / font.widthOfTextAtSize(footer, footSize)))
      : footer
    page.drawText(footText, { x: 12, y: 8, size: footSize, font, color: grey, opacity: 0.8 })
    if (banner && bold) {
      // Shrunk to fit the page width when it would run off the edge.
      let bannerSize = Math.max(8, Math.min(12, width / 50))
      while (bannerSize > 5 && bold.widthOfTextAtSize(banner, bannerSize) > width - 24) bannerSize -= 0.5
      page.drawText(banner, { x: 12, y: height - 10 - bannerSize, size: bannerSize, font: bold, color: rgb(0.72, 0.11, 0.11), opacity: 0.95 })
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }))
}
