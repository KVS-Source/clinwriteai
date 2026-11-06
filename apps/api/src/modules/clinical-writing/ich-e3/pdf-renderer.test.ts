import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { IchE3Report } from './catalog.js'
import { renderIchE3Pdf } from './pdf-renderer.js'

function report(sectionCount: number): IchE3Report {
  return {
    documentTitle: 'CSR Velora-301',
    completionPercent: 0,
    completeCount: 0,
    waivedCount: 0,
    totalSections: sectionCount,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      code: `§${i + 1}`, title: `Section ${i + 1}`, status: 'in_progress', conditional: false, inDocument: true, waiver: null,
    })),
  } as unknown as IchE3Report
}

async function pageCount(sectionCount: number) {
  const pdf = await renderIchE3Pdf({ report: report(sectionCount), generatedBy: 'Raj', generatedAt: new Date('2026-11-06T00:00:00Z') })
  return (await PDFDocument.load(pdf)).getPageCount()
}

describe('renderIchE3Pdf page numbers (CW-040)', () => {
  it('keeps a short report on one page: the page number adds no page of its own', async () => {
    expect(await pageCount(18)).toBe(1)
  })

  it('adds no extra pages to a long report', async () => {
    // 120 rows fill about 3 pages; a page number that spilled over would double that.
    expect(await pageCount(120)).toBeLessThanOrEqual(4)
  })
})
