// Reports & Analytics screen (sPM16) — the catalogue, module health and
// report generation endpoints the UI calls:
//   GET  /reports/available                 report catalogue (+ last generated)
//   GET  /reports/health-scores             per-module health from live data
//   POST /reports/:type/generate            audit + return a download URL
//   GET  /reports/:type/download            CSV / PDF built from live data
// Previously only MSW mocks served these, so with mocks off the report-type
// dropdown was empty and Generate went nowhere.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { requireAuth } from '../../../auth/rbac.js'

const REPORTS = [
  { id: 'rpt-001', type: 'project-summary',        label: 'Project Summary Report',        description: 'Activity summary per project — status, therapeutic area and document counts' },
  { id: 'rpt-002', type: 'module-activity',        label: 'Module Activity Report',        description: 'Clinical Writing documents created or updated in the date range' },
  { id: 'rpt-003', type: 'ai-usage',               label: 'AI Usage Report',               description: 'AI calls in the date range — module, model, tokens and cost' },
  { id: 'rpt-004', type: 'user-activity',          label: 'User Activity Report',          description: 'Audited actions per user in the date range' },
  { id: 'rpt-005', type: 'compliance',             label: 'Compliance Report',             description: 'Audit-trail event counts by action in the date range (21 CFR Part 11)' },
  { id: 'rpt-006', type: 'publishing-performance', label: 'Publishing Performance Report', description: 'Publications by status' },
] as const

type ReportType = (typeof REPORTS)[number]['type']
const REPORT_TYPES = REPORTS.map(r => r.type) as [ReportType, ...ReportType[]]

const MODULE_LABELS = { A: 'Clinical Writing', B: 'Scientific Writing', C: 'Medical Writing', D: 'Regulatory Writing', E: 'Ideation & Publishing' } as const

const rangeSchema = z.object({
  format:   z.enum(['csv', 'pdf']).default('csv'),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const adminOnly = requireAuth({ roles: ['admin', 'super-admin'] })

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function renderTablePdf(title: string, subtitle: string, header: string[], rows: unknown[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: title } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica-Bold').fontSize(14).text(title)
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(subtitle).moveDown(0.6)
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8).text(header.join('  |  ')).moveDown(0.3)
    doc.font('Helvetica').fontSize(8)
    for (const r of rows) {
      if (doc.y > doc.page.height - 50) doc.addPage()
      doc.text(r.map(c => (c instanceof Date ? c.toISOString().slice(0, 16).replace('T', ' ') : String(c ?? ''))).join('  |  '))
    }
    if (rows.length === 0) doc.text('No data for this range.')
    doc.end()
  })
}

export const reportsCatalogueRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reports/available', { preHandler: adminOnly }, async () => {
    // lastGenerated / generatedBy come from the audit chain.
    const last = await app.prisma.$queryRaw<Array<{ entity_id: string; ts: Date; actor_id: string }>>`
      SELECT DISTINCT ON (entity_id) entity_id, "timestamp" AS ts, actor_id
      FROM audit_events WHERE action = 'report_generated'
      ORDER BY entity_id, "timestamp" DESC`
    const byType = new Map(last.map(l => [l.entity_id, l]))
    return REPORTS.map(r => ({
      ...r,
      availableFormats: ['pdf', 'csv'],
      lastGenerated: byType.get(r.type)?.ts.toISOString() ?? null,
      generatedBy:   byType.get(r.type)?.actor_id ?? null,
    }))
  })

  app.get('/reports/health-scores', { preHandler: adminOnly }, async () => {
    const now = new Date()
    const [docs, pubs, med, subs, ideas] = await Promise.all([
      app.prisma.document.findMany({ where: { deletedAt: null }, select: { status: true, targetCompletionDate: true } }),
      app.prisma.publication.findMany({ select: { status: true } }),
      app.prisma.medContentItem.findMany({ where: { archivedAt: null }, select: { status: true } }),
      app.prisma.regulatorySubmission.findMany({ select: { status: true } }),
      app.prisma.ideationProject.findMany({ select: { status: true } }),
    ])
    // Statuses that count as "done" per module.
    const done: Record<keyof typeof MODULE_LABELS, Set<string>> = {
      A: new Set(['signed', 'final', 'approved']),
      B: new Set(['published', 'accepted']),
      C: new Set(['mlr_approved', 'final_output']),
      D: new Set(['submitted', 'accepted', 'approved']),
      E: new Set(['published', 'completed']),
    }
    const rows: Record<keyof typeof MODULE_LABELS, Array<{ status: string; overdue?: boolean }>> = {
      A: docs.map(d => ({ status: d.status, overdue: !!d.targetCompletionDate && d.targetCompletionDate < now && !done.A.has(d.status) })),
      B: pubs, C: med, D: subs, E: ideas,
    }
    return (Object.keys(MODULE_LABELS) as Array<keyof typeof MODULE_LABELS>).map(m => {
      const items = rows[m]
      const total = items.length
      const completed = items.filter(i => done[m].has(i.status)).length
      const overdue = items.filter(i => i.overdue).length
      const completionRate = total ? Math.round((completed / total) * 100) : 0
      const onTime = total ? 1 - overdue / total : 1
      return {
        module: m,
        label: MODULE_LABELS[m],
        // Blend of completion and on-time delivery (0–100).
        healthScore: total ? Math.round(completionRate * 0.6 + onTime * 40) : 0,
        completionRate,
        reviewPassRate: 0,      // not tracked yet
        crmCompletionRate: 0,   // not tracked yet
        avgStageDays: 0,        // not tracked yet
        activeDocuments: total - completed,
        overdueDocuments: overdue,
      }
    })
  })

  app.post('/reports/:type/generate', { preHandler: adminOnly }, async (request, reply) => {
    const type = z.enum(REPORT_TYPES).safeParse((request.params as { type: string }).type)
    if (!type.success) return reply.code(404).send({ error: 'unknown_report' })
    const body = rangeSchema.safeParse(request.body ?? {})
    if (!body.success) return reply.code(400).send({ error: 'validation', issues: body.error.issues })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'report_generated',
      entityType: 'report',
      entityId: type.data,
      details: { format: body.data.format, dateFrom: body.data.dateFrom ?? null, dateTo: body.data.dateTo ?? null },
      ipAddress: request.ip ?? null,
    })

    const q = new URLSearchParams({ format: body.data.format })
    if (body.data.dateFrom) q.set('dateFrom', body.data.dateFrom)
    if (body.data.dateTo) q.set('dateTo', body.data.dateTo)
    return {
      reportType: type.data,
      format: body.data.format,
      generatedAt: new Date().toISOString(),
      downloadUrl: `/reports/${type.data}/download?${q.toString()}`,   // relative to the API base
    }
  })

  app.get('/reports/:type/download', { preHandler: adminOnly }, async (request, reply) => {
    const type = z.enum(REPORT_TYPES).safeParse((request.params as { type: string }).type)
    if (!type.success) return reply.code(404).send({ error: 'unknown_report' })
    const q = rangeSchema.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const from = q.data.dateFrom ? new Date(`${q.data.dateFrom}T00:00:00Z`) : new Date(0)
    const to   = q.data.dateTo   ? new Date(`${q.data.dateTo}T23:59:59.999Z`) : new Date()

    let header: string[] = []
    let rows: unknown[][] = []
    switch (type.data) {
      case 'project-summary': {
        const projects = await app.prisma.project.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, therapeuticArea: true, phase: true } })
        const counts = await app.prisma.document.groupBy({ by: ['projectId'], where: { deletedAt: null }, _count: { _all: true } })
        const byProject = new Map(counts.map(c => [c.projectId, c._count._all]))
        header = ['projectId', 'name', 'status', 'therapeuticArea', 'phase', 'documents']
        rows = projects.map(p => [p.id, p.name, p.status, p.therapeuticArea, p.phase, byProject.get(p.id) ?? 0])
        break
      }
      case 'module-activity': {
        const docs = await app.prisma.document.findMany({
          where: { deletedAt: null, updatedAt: { gte: from, lte: to } },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, title: true, type: true, status: true, projectId: true, updatedAt: true },
        })
        header = ['documentId', 'title', 'type', 'status', 'projectId', 'updatedAt']
        rows = docs.map(d => [d.id, d.title, d.type, d.status, d.projectId, d.updatedAt])
        break
      }
      case 'ai-usage': {
        const calls = await app.prisma.aiCallRecord.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, module: true, model: true, intent: true, inputTokens: true, outputTokens: true, costUsd: true, actorId: true },
        })
        header = ['createdAt', 'module', 'model', 'intent', 'inputTokens', 'outputTokens', 'costUsd', 'actorId']
        rows = calls.map(c => [c.createdAt, c.module, c.model, c.intent, c.inputTokens, c.outputTokens, c.costUsd.toString(), c.actorId])
        break
      }
      case 'user-activity': {
        const r = await app.prisma.$queryRaw<Array<{ actor_id: string; name: string | null; events: number; last_event: Date }>>`
          SELECT a.actor_id, u.name, count(*)::int AS events, max(a."timestamp") AS last_event
          FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a."timestamp" BETWEEN ${from} AND ${to} AND a.entity_type <> 'http_request'
          GROUP BY a.actor_id, u.name ORDER BY events DESC`
        header = ['actorId', 'name', 'events', 'lastEvent']
        rows = r.map(x => [x.actor_id, x.name ?? '', x.events, x.last_event])
        break
      }
      case 'compliance': {
        const r = await app.prisma.$queryRaw<Array<{ action: string; events: number }>>`
          SELECT action, count(*)::int AS events FROM audit_events
          WHERE "timestamp" BETWEEN ${from} AND ${to} AND entity_type <> 'http_request'
          GROUP BY action ORDER BY events DESC`
        header = ['action', 'events']
        rows = r.map(x => [x.action, x.events])
        break
      }
      case 'publishing-performance': {
        const r = await app.prisma.publication.groupBy({ by: ['status'], _count: { _all: true } })
        header = ['status', 'publications']
        rows = r.map(x => [x.status, x._count._all])
        break
      }
    }

    const label = REPORTS.find(r => r.type === type.data)!.label
    const range = `${q.data.dateFrom ?? 'beginning'} → ${q.data.dateTo ?? 'today'}`
    const fileBase = `${type.data}-${new Date().toISOString().slice(0, 10)}`
    if (q.data.format === 'pdf') {
      const pdf = await renderTablePdf(label, `${range} · generated ${new Date().toISOString()}`, header, rows)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${fileBase}.pdf"`)
      return reply.send(pdf)
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${fileBase}.csv"`)
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  })
}
