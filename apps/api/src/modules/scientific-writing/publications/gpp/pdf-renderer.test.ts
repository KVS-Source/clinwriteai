// Snapshot-level smoke for the GPP-2022 PDF renderer. Doesn't try to
// pixel-match (pdfkit output has fontconfig/version drift); instead
// asserts bytes are produced, header is PDF 1.3+, and the renderer
// doesn't throw on common input shapes.

import { describe, expect, it } from 'vitest'
import { renderGppReportPdf, type GppReport } from './pdf-renderer.js'

function sampleReport(overrides: Partial<GppReport> = {}): GppReport {
  return {
    project: { id: 'p1', name: 'Test Project', therapeuticArea: 'Oncology' },
    standard: 'GPP-2022',
    scope: { publicationCount: 1, totalPillars: 8, totalPassed: 7, overallPct: 88 },
    publications: [
      {
        id: 'pub1', title: 'Primary endpoint analysis', type: 'manuscript',
        stage: 'in_authoring', status: 'draft', guideline: 'CONSORT', journal: 'NEJM',
        pillars: {
          authorship_icmje: true, writing_assistance_disclosed: true,
          trial_registration: true, data_sharing_statement: false,
          coi_disclosure: true, timely_publication: true,
          reporting_guideline: true, baa_in_place: true,
        },
        passedCount: 7, passedPct: 88,
      },
    ],
    generatedAt: new Date('2026-10-05T12:00:00Z').toISOString(),
    ...overrides,
  }
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c instanceof Buffer ? c : Buffer.from(c as string))
  return Buffer.concat(chunks)
}

describe('renderGppReportPdf', () => {
  it('produces a valid PDF header', async () => {
    const buf = await collect(renderGppReportPdf(sampleReport()))
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('handles zero-publication projects', async () => {
    const buf = await collect(renderGppReportPdf(sampleReport({
      publications: [],
      scope: { publicationCount: 0, totalPillars: 0, totalPassed: 0, overallPct: 0 },
    })))
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders multi-publication reports with growing page count', async () => {
    const single = await collect(renderGppReportPdf(sampleReport()))
    const multi = await collect(renderGppReportPdf({
      ...sampleReport(),
      scope: { publicationCount: 3, totalPillars: 24, totalPassed: 20, overallPct: 83 },
      publications: Array.from({ length: 3 }, (_, i) => ({
        id: `pub${i + 1}`, title: `Pub ${i + 1}`, type: 'manuscript',
        stage: 'in_authoring', status: 'draft', guideline: 'CONSORT', journal: 'Lancet',
        pillars: {
          authorship_icmje: true, writing_assistance_disclosed: true,
          trial_registration: true, data_sharing_statement: true,
          coi_disclosure: true, timely_publication: true,
          reporting_guideline: true, baa_in_place: true,
        },
        passedCount: 8, passedPct: 100,
      })),
    }))
    // Pages grow with publication count — bytes should too.
    expect(multi.length).toBeGreaterThan(single.length)
  })
})
