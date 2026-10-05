// Compliance report — PDF renderer.
//
// Mirrors the GPP-2022 pdfkit pattern. One-page cover (window + top-line
// metrics) + follow-on pages for the audit action breakdown. Auditors
// typically want signed PDF for binder evidence; this is the attestable
// artefact alongside the JSON (which stays available for API clients).

import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'
import type { ComplianceReport } from './builder.js'

export function renderComplianceReportPdf(report: ComplianceReport): NodeJS.ReadableStream {
  const stream = new PassThrough()
  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,
    bufferPages: true,
    info: {
      Title: `Compliance report — ${report.window.from} to ${report.window.to}`,
      Author: 'Aurora Platform',
      Subject: 'Platform compliance evidence (audit, AI, identity)',
      CreationDate: new Date(report.generatedAt),
    },
  })

  doc.pipe(stream)

  // --- Cover page ---------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(24).text('Compliance Report')
    .moveDown(0.4)
    .font('Helvetica').fontSize(11).fillColor('#444')
    .text(`Window: ${report.window.from.slice(0, 10)} → ${report.window.to.slice(0, 10)}`)
    .text(`Generated: ${report.generatedAt}`)
    .moveDown(1.5)

  // Chain integrity banner — the single most important signal.
  const chainOk = report.audit.chainIntegrity.intact
  const chainColour = chainOk ? '#2a7a2a' : '#a81d1d'
  doc.font('Helvetica-Bold').fontSize(18).fillColor(chainColour)
    .text(chainOk ? 'Audit chain intact ✓' : 'Audit chain BROKEN ✗')
  if (!chainOk) {
    doc.font('Helvetica').fontSize(11).fillColor('#555')
      .text(`First break at row ${report.audit.chainIntegrity.firstBreakAt ?? '?'}. Investigate per docs/compliance/runbooks/incident-response.md "audit chain break".`)
  }
  doc.moveDown(1.5)

  // Top-line metrics grid (two columns)
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text('Top-line metrics')
  doc.moveDown(0.3)
  const metrics: Array<[string, string]> = [
    ['Audit events (window)', String(report.audit.totalEvents)],
    ['AI calls (window)', String(report.ai.totalCalls)],
    ['AI spend (window)', `$${report.ai.totalCostUsd.toFixed(2)}`],
    ['Input tokens', report.ai.totalInputTokens.toLocaleString()],
    ['Output tokens', report.ai.totalOutputTokens.toLocaleString()],
    ['Users (total)', String(report.identity.userCount)],
    ['Active sessions (now)', String(report.identity.activeSessionCount)],
  ]
  const labelX = 54
  const valueX = 260
  const startY = doc.y
  doc.font('Helvetica').fontSize(10).fillColor('#333')
  metrics.forEach(([label, value], i) => {
    const y = startY + i * 16
    doc.text(label, labelX, y)
    doc.font('Helvetica-Bold').text(value, valueX, y)
    doc.font('Helvetica')
  })
  doc.y = startY + metrics.length * 16 + 20

  // --- Audit action breakdown (page break if needed) ---------------------
  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text('Audit events by action')
  doc.moveDown(0.3)
  doc.font('Helvetica').fontSize(10).fillColor('#555')
    .text(`Window: ${report.window.from.slice(0, 10)} → ${report.window.to.slice(0, 10)}`)
    .text(`Total: ${report.audit.totalEvents.toLocaleString()}`)
  doc.moveDown(0.8)

  if (report.audit.byAction.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#555').text('No audit events in this window.')
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
    const actionX = 54
    const countX = 420
    let y = doc.y
    doc.text('Action', actionX, y)
    doc.text('Count', countX, y, { align: 'right', width: 100 })
    y += 14
    doc.moveTo(54, y).lineTo(541, y).strokeColor('#ccc').stroke()
    y += 6

    doc.font('Helvetica').fontSize(10).fillColor('#333')
    for (const row of report.audit.byAction) {
      if (y > doc.page.height - 72) {
        doc.addPage()
        y = 54
      }
      doc.text(row.action, actionX, y)
      doc.text(row.count.toLocaleString(), countX, y, { align: 'right', width: 100 })
      y += 14
    }
    doc.y = y
  }

  // Footer on every page
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(
        `Aurora Platform  •  Compliance Report  •  Page ${i + 1} of ${range.count}`,
        54, doc.page.height - 36,
        { align: 'center', width: doc.page.width - 108 },
      )
  }

  doc.end()
  return stream
}
