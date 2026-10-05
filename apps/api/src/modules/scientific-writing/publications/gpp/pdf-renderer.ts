// GPP-2022 compliance report — PDF renderer.
//
// Uses pdfkit directly (no HTML intermediate) so we stream bytes with
// zero browser dependency. The report layout is one-page-per-publication
// after a cover page; the UI's "Download PDF" button calls the .pdf
// endpoint and the browser handles the download.
//
// Fonts: pdfkit's built-in Helvetica / Helvetica-Bold. No external font
// files to bundle — keeps the Node binary trivially portable across
// environments.

import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

export interface GppPillars {
  authorship_icmje: boolean
  writing_assistance_disclosed: boolean
  trial_registration: boolean
  data_sharing_statement: boolean
  coi_disclosure: boolean
  timely_publication: boolean
  reporting_guideline: boolean
  baa_in_place: boolean
}

export interface GppPubRow {
  id: string
  title: string
  type: string
  stage: string
  status: string
  guideline: string
  journal: string | null
  pillars: GppPillars
  passedCount: number
  passedPct: number
}

export interface GppReport {
  project: { id: string; name: string; therapeuticArea: string }
  standard: string
  scope: {
    publicationCount: number
    totalPillars: number
    totalPassed: number
    overallPct: number
  }
  publications: GppPubRow[]
  generatedAt: string
}

const PILLAR_LABELS: Record<keyof GppPillars, string> = {
  authorship_icmje: 'Authorship (ICMJE criteria + acknowledgement)',
  writing_assistance_disclosed: 'Writing assistance disclosed',
  trial_registration: 'Clinical trial registration linked',
  data_sharing_statement: 'Data sharing statement present',
  coi_disclosure: 'Conflict-of-interest disclosure (debarment clear)',
  timely_publication: 'Timely publication target recorded',
  reporting_guideline: 'Reporting guideline (CONSORT/STROBE/etc.) applied',
  baa_in_place: 'BAA in place (or not applicable)',
}

/**
 * Render the GPP-2022 report to a PDF stream. Caller is responsible for
 * piping the stream to the HTTP response and setting Content-Type.
 * Returns a readable stream of PDF bytes.
 */
export function renderGppReportPdf(report: GppReport): NodeJS.ReadableStream {
  const stream = new PassThrough()
  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,                         // 0.75"
    // bufferPages lets us retro-stamp "Page X of Y" after assembly knows
    // the final count. The default (false) streams pages as it goes but
    // forgets them, so bufferedPageRange() would be empty.
    bufferPages: true,
    info: {
      Title: `GPP-2022 compliance report — ${report.project.name}`,
      Author: 'Aurora Platform',
      Subject: `Good Publication Practice 2022 — ${report.project.therapeuticArea}`,
      CreationDate: new Date(report.generatedAt),
    },
  })

  doc.pipe(stream)

  // --- Cover page ---------------------------------------------------------
  doc
    .font('Helvetica-Bold').fontSize(24).text('GPP-2022 Compliance Report', { align: 'left' })
    .moveDown(0.5)
    .font('Helvetica').fontSize(12).fillColor('#444')
    .text(`Standard: Good Publication Practice 2022 (GPP-2022)`)
    .text(`Project: ${report.project.name}`)
    .text(`Therapeutic area: ${report.project.therapeuticArea}`)
    .text(`Generated: ${report.generatedAt}`)
    .moveDown(1)

  // Overall score banner
  const overallColour = report.scope.overallPct >= 90 ? '#2a7a2a'
    : report.scope.overallPct >= 70 ? '#b57a00'
    : '#a81d1d'
  doc.font('Helvetica-Bold').fontSize(32).fillColor(overallColour)
    .text(`${report.scope.overallPct}%`, { align: 'left' })
    .fontSize(12).fillColor('#444').font('Helvetica')
    .text(`${report.scope.totalPassed} of ${report.scope.totalPillars} pillars passed across ${report.scope.publicationCount} publication(s)`)
    .moveDown(2)

  // Pillar legend
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text('GPP-2022 pillars assessed')
  doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#333')
  for (const [, label] of Object.entries(PILLAR_LABELS)) {
    doc.text(`• ${label}`)
  }

  // --- One page per publication ------------------------------------------
  for (const pub of report.publications) {
    doc.addPage()
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000').text(pub.title)
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(10).fillColor('#555')
      .text(`Type: ${pub.type}   •   Stage: ${pub.stage}   •   Status: ${pub.status}`)
      .text(`Guideline: ${pub.guideline}   •   Journal: ${pub.journal ?? '—'}`)
      .moveDown(0.6)

    const pubColour = pub.passedPct >= 90 ? '#2a7a2a'
      : pub.passedPct >= 70 ? '#b57a00'
      : '#a81d1d'
    doc.font('Helvetica-Bold').fontSize(20).fillColor(pubColour)
      .text(`${pub.passedPct}%  (${pub.passedCount}/8 pillars)`)
      .moveDown(1)

    // Pillar table
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Pillar outcomes')
    doc.moveDown(0.2)
    for (const [key, label] of Object.entries(PILLAR_LABELS) as [keyof GppPillars, string][]) {
      const pass = pub.pillars[key]
      const mark = pass ? '[PASS]' : '[FAIL]'
      const colour = pass ? '#2a7a2a' : '#a81d1d'
      doc.font('Helvetica-Bold').fontSize(10).fillColor(colour).text(mark, { continued: true })
      doc.font('Helvetica').fillColor('#333').text('  ' + label)
    }
  }

  // Footer on every page — page numbers only. pdfkit's bufferPages lets us
  // iterate after assembly to stamp page X of Y.
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(
        `Aurora Platform  •  GPP-2022  •  Page ${i + 1} of ${range.count}`,
        54, doc.page.height - 36,
        { align: 'center', width: doc.page.width - 108 },
      )
  }

  doc.end()
  return stream
}
