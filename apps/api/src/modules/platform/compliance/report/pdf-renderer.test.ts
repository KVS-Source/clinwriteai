// Smoke for the compliance report PDF renderer. Same shape as the
// GPP renderer tests — byte-count + header check, no pixel match.

import { describe, expect, it } from 'vitest'
import { renderComplianceReportPdf } from './pdf-renderer.js'
import type { ComplianceReport } from './builder.js'

function sampleReport(overrides: Partial<ComplianceReport> = {}): ComplianceReport {
  return {
    window: { from: '2026-09-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
    audit: {
      totalEvents: 100,
      byAction: [{ action: 'document_created', count: 50 }, { action: 'comment_added', count: 50 }],
      chainIntegrity: { intact: true, verifiedAt: new Date('2026-10-05').toISOString(), totalRows: 100 },
    },
    ai: { totalCalls: 10, totalCostUsd: 1.23, totalInputTokens: 1000, totalOutputTokens: 500 },
    identity: { userCount: 5, activeSessionCount: 2 },
    generatedAt: '2026-10-05T12:00:00Z',
    ...overrides,
  }
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c instanceof Buffer ? c : Buffer.from(c as string))
  return Buffer.concat(chunks)
}

describe('renderComplianceReportPdf', () => {
  it('produces a valid PDF header', async () => {
    const buf = await collect(renderComplianceReportPdf(sampleReport()))
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders green when chain is intact', async () => {
    // Smoke-only — can't easily assert pixel colour, but verifies the
    // intact=true branch doesn't throw.
    const buf = await collect(renderComplianceReportPdf(sampleReport()))
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders broken-chain variant without throwing', async () => {
    const buf = await collect(renderComplianceReportPdf(sampleReport({
      audit: {
        totalEvents: 100,
        byAction: [{ action: 'document_created', count: 50 }],
        chainIntegrity: { intact: false, firstBreakAt: '42', verifiedAt: new Date().toISOString(), totalRows: 100 },
      },
    })))
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('handles empty audit action list', async () => {
    const buf = await collect(renderComplianceReportPdf(sampleReport({
      audit: {
        totalEvents: 0,
        byAction: [],
        chainIntegrity: { intact: true, verifiedAt: new Date().toISOString(), totalRows: 0 },
      },
    })))
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
