// Reports & Analytics screen (sPM16) — the catalogue, module health and
// report generation endpoints the UI calls:
//   GET  /reports/available                 report catalogue (+ last generated)
//   GET  /reports/health-scores             per-module health from live data
//   POST /reports/:type/generate            audit + return a download URL
//   GET  /reports/:type/download            CSV / PDF built from live data
//   GET  /reports/:type/preview             the same report as JSON, shown on screen
//   GET  /reports/cost-summary              AI tokens + cost this billing period
// Previously only MSW mocks served these, so with mocks off the report-type
// dropdown was empty and Generate went nowhere.
//
// Reports belong to the Project Manager (moved from the IT admin): every figure and report covers only the
// projects the PM manages (created, or added to as Project Manager), the same set their project list shows.
// The organisation-wide User Activity and Compliance (audit) reports aren't offered to a PM.
//
// Clinical Writing only: health, cost and every report cover Module A. The other modules' data (publications,
// medical content, submissions, ideation, and their AI calls) is left out, and the Publishing Performance report
// (Module B) isn't offered.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import { visibleProjectIdsForUser } from '../../projects/visibility.js'
import { billingPeriod } from '../subscriptions/usage.js'

const REPORTS = [
  { id: 'rpt-001', type: 'project-summary',        label: 'Project Summary Report',        description: 'Each project you manage — status, therapeutic area, phase, and its documents: signed, in progress and overdue' },
  { id: 'rpt-002', type: 'module-activity',        label: 'Module Activity Report',        description: 'Clinical Writing documents created or updated in the date range' },
  { id: 'rpt-003', type: 'ai-usage',               label: 'AI Usage Report',               description: 'Clinical Writing AI calls in the date range — model, tokens and cost' },
] as const

type ReportType = (typeof REPORTS)[number]['type']
const REPORT_TYPES = REPORTS.map(r => r.type) as [ReportType, ...ReportType[]]

// AI calls made in Clinical Writing (AiCallRecord.module).
const CLINICAL_WRITING_AI = { module: 'A' }

const rangeSchema = z.object({
  format:   z.enum(['csv', 'pdf']).default('csv'),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// A user with PM + another role passes while working as PM (X-Active-Role narrows the request to 'pm').
const pmOnly = requireAuth({ roles: ['pm'] })

/**
 * The projects the PM manages. Always resolved as PM: a download opened as a plain link carries no
 * X-Active-Role header, and a PM + Contributor must not get their Contributor projects in it.
 */
async function managedProjectIds(prisma: Parameters<typeof visibleProjectIdsForUser>[0], user: AuthenticatedUser): Promise<string[]> {
  const ids = await visibleProjectIdsForUser(prisma, { ...user, role: 'pm', roles: ['pm'] })
  return ids === 'all' ? [] : [...ids]
}

// Report times are shown in India Standard Time (UTC+05:30, no DST) — "yyyy-mm-dd hh:mm IST".
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
function istStamp(d: Date): string {
  return `${new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} IST`
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : v instanceof Date ? istStamp(v) : String(v)
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
      doc.text(r.map(c => (c instanceof Date ? istStamp(c) : String(c ?? ''))).join('  |  '))
    }
    if (rows.length === 0) doc.text('No data for this range.')
    doc.end()
  })
}

export const reportsCatalogueRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reports/available', { preHandler: pmOnly }, async (request) => {
    // lastGenerated / generatedBy come from the audit chain: the PM's own generations.
    const last = await app.prisma.$queryRaw<Array<{ entity_id: string; ts: Date; actor_id: string }>>`
      SELECT DISTINCT ON (entity_id) entity_id, "timestamp" AS ts, actor_id
      FROM audit_events WHERE action = 'report_generated' AND actor_id = ${request.user!.id}
      ORDER BY entity_id, "timestamp" DESC`
    const byType = new Map(last.map(l => [l.entity_id, l]))
    return REPORTS.map(r => ({
      ...r,
      availableFormats: ['pdf', 'csv'],
      lastGenerated: byType.get(r.type)?.ts.toISOString() ?? null,
      generatedBy:   byType.get(r.type)?.actor_id ?? null,
    }))
  })

  // Clinical Writing health for the PM's projects: completion blended with on-time delivery (0–100).
  app.get('/reports/health-scores', { preHandler: pmOnly }, async (request) => {
    const now = new Date()
    const docs = await app.prisma.document.findMany({
      where:  { deletedAt: null, projectId: { in: await managedProjectIds(app.prisma, request.user!) } },
      select: { status: true, targetCompletionDate: true },
    })
    const done = new Set(['signed', 'final', 'approved'])
    const total = docs.length
    const completed = docs.filter(d => done.has(d.status)).length
    const overdue = docs.filter(d => !!d.targetCompletionDate && d.targetCompletionDate < now && !done.has(d.status)).length
    const completionRate = total ? Math.round((completed / total) * 100) : 0
    const onTime = total ? 1 - overdue / total : 1
    return [{
      module: 'A',
      label: 'Clinical Writing',
      healthScore: total ? Math.round(completionRate * 0.6 + onTime * 40) : 0,
      completionRate,
      reviewPassRate: 0,      // not tracked yet
      crmCompletionRate: 0,   // not tracked yet
      avgStageDays: 0,        // not tracked yet
      activeDocuments: total - completed,
      overdueDocuments: overdue,
    }]
  })

  app.post('/reports/:type/generate', { preHandler: pmOnly }, async (request, reply) => {
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

  // The rows of one report for the PM's projects (Clinical Writing only), shared by the on-screen view and the
  // PDF / CSV download so both always say the same thing. `summary` is the headline figures above the table.
  async function buildReport(type: ReportType, user: AuthenticatedUser, from: Date, to: Date) {
    const projectIds = await managedProjectIds(app.prisma, user)
    const inProjects = { projectId: { in: projectIds } }
    const now = new Date()
    const DONE = new Set(['signed', 'final', 'approved'])
    let header: string[] = []
    let rows: unknown[][] = []
    let summary: Array<{ label: string; value: string | number }> = []

    switch (type) {
      // PRD sPM16: a per-project summary, as on the Project Dashboard — status, documents, completed, overdue.
      case 'project-summary': {
        const [projects, docs] = await Promise.all([
          app.prisma.project.findMany({ where: { id: { in: projectIds } }, orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, therapeuticArea: true, phase: true } }),
          app.prisma.document.findMany({ where: { deletedAt: null, ...inProjects }, select: { projectId: true, status: true, targetCompletionDate: true } }),
        ])
        const per = new Map<string, { total: number; signed: number; overdue: number }>()
        for (const d of docs) {
          const c = per.get(d.projectId) ?? { total: 0, signed: 0, overdue: 0 }
          c.total++
          if (DONE.has(d.status)) c.signed++
          else if (d.targetCompletionDate && d.targetCompletionDate < now) c.overdue++
          per.set(d.projectId, c)
        }
        header = ['Project', 'Status', 'Therapeutic area', 'Phase', 'Documents', 'Signed', 'In progress', 'Overdue']
        rows = projects.map(p => {
          const c = per.get(p.id) ?? { total: 0, signed: 0, overdue: 0 }
          return [p.name, p.status, p.therapeuticArea, p.phase, c.total, c.signed, c.total - c.signed, c.overdue]
        })
        const signed = docs.filter(d => DONE.has(d.status)).length
        summary = [
          { label: 'Projects', value: projects.length },
          { label: 'Documents', value: docs.length },
          { label: 'Signed', value: signed },
          { label: 'Overdue', value: docs.filter(d => !DONE.has(d.status) && d.targetCompletionDate && d.targetCompletionDate < now).length },
        ]
        break
      }
      // PRD sPM16: module activity over the date range — the Clinical Writing documents worked on.
      case 'module-activity': {
        const docs = await app.prisma.document.findMany({
          where: { deletedAt: null, ...inProjects, updatedAt: { gte: from, lte: to } },
          orderBy: { updatedAt: 'desc' },
          select: { title: true, type: true, status: true, createdAt: true, updatedAt: true, projectId: true },
        })
        const names = new Map((await app.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })).map(p => [p.id, p.name]))
        header = ['Document', 'Type', 'Status', 'Project', 'Created', 'Last updated']
        rows = docs.map(d => [d.title, d.type, d.status, names.get(d.projectId) ?? '', d.createdAt, d.updatedAt])
        summary = [
          { label: 'Documents worked on', value: docs.length },
          { label: 'Created in range', value: docs.filter(d => d.createdAt >= from && d.createdAt <= to).length },
          { label: 'Signed', value: docs.filter(d => DONE.has(d.status)).length },
          { label: 'In review', value: docs.filter(d => /review/.test(d.status)).length },
        ]
        break
      }
      // PRD sPM16: AI usage — tokens, cost and the model breakdown.
      case 'ai-usage': {
        const calls = await app.prisma.aiCallRecord.findMany({
          where: { ...inProjects, ...CLINICAL_WRITING_AI, createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, model: true, intent: true, inputTokens: true, outputTokens: true, costUsd: true, actorId: true },
        })
        const actors = await app.prisma.user.findMany({ where: { id: { in: [...new Set(calls.map(c => c.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })
        const nameOf = new Map(actors.map(a => [a.id, a.name]))
        header = ['When', 'Model', 'Purpose', 'User', 'Input tokens', 'Output tokens', 'Cost (USD)']
        rows = calls.map(c => [c.createdAt, c.model, c.intent, (c.actorId && nameOf.get(c.actorId)) ?? '', c.inputTokens, c.outputTokens, Number(c.costUsd).toFixed(4)])
        const tokens = calls.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0)
        const cost = calls.reduce((n, c) => n + Number(c.costUsd), 0)
        const byModel = new Map<string, number>()
        for (const c of calls) byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1)
        summary = [
          { label: 'AI calls', value: calls.length },
          { label: 'Tokens', value: tokens.toLocaleString('en-US') },
          { label: 'Cost', value: `$${cost.toFixed(2)}` },
          { label: 'Models', value: [...byModel].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`).join(', ') || '—' },
        ]
        break
      }
    }
    return { header, rows, summary }
  }

  function rangeOf(q: { dateFrom?: string; dateTo?: string }) {
    return {
      from: q.dateFrom ? new Date(`${q.dateFrom}T00:00:00Z`) : new Date(0),
      to:   q.dateTo   ? new Date(`${q.dateTo}T23:59:59.999Z`) : new Date(),
    }
  }

  // The report on screen (left menu → report): headline figures + the first rows of the table.
  const PREVIEW_ROWS = 200
  app.get('/reports/:type/preview', { preHandler: pmOnly }, async (request, reply) => {
    const type = z.enum(REPORT_TYPES).safeParse((request.params as { type: string }).type)
    if (!type.success) return reply.code(404).send({ error: 'unknown_report' })
    const q = rangeSchema.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })
    const { from, to } = rangeOf(q.data)
    const r = await buildReport(type.data, request.user!, from, to)
    return {
      reportType: type.data,
      header:     r.header,
      rows:       r.rows.slice(0, PREVIEW_ROWS).map(row => row.map(c => (c instanceof Date ? c.toISOString() : c))),
      totalRows:  r.rows.length,
      summary:    r.summary,
    }
  })

  app.get('/reports/:type/download', { preHandler: pmOnly }, async (request, reply) => {
    const type = z.enum(REPORT_TYPES).safeParse((request.params as { type: string }).type)
    if (!type.success) return reply.code(404).send({ error: 'unknown_report' })
    const q = rangeSchema.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })
    const { from, to } = rangeOf(q.data)
    const { header, rows } = await buildReport(type.data, request.user!, from, to)

    const label = REPORTS.find(r => r.type === type.data)!.label
    const range = `${q.data.dateFrom ?? 'beginning'} → ${q.data.dateTo ?? 'today'}`
    const fileBase = `${type.data}-${new Date().toISOString().slice(0, 10)}`
    if (q.data.format === 'pdf') {
      const pdf = await renderTablePdf(label, `${range} · generated ${istStamp(new Date())}`, header, rows)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${fileBase}.pdf"`)
      return reply.send(pdf)
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${fileBase}.csv"`)
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  })

  // The cost panel: Clinical Writing AI tokens and cost on the PM's projects since the start of the tenant's billing period
  // (the same period /services/dashboard uses), from the AI call log.
  app.get('/reports/cost-summary', { preHandler: pmOnly }, async (request) => {
    const user = request.user!
    const [projectIds, tenant, sub] = await Promise.all([
      managedProjectIds(app.prisma, user),
      user.tenantId ? app.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }) : null,
      user.tenantId
        ? app.prisma.subscription.findFirst({ where: { tenantId: user.tenantId, endedAt: null }, orderBy: { startedAt: 'desc' }, select: { rolloverDay: true } })
        : null,
    ])
    const { start } = billingPeriod(sub?.rolloverDay ?? 1, new Date())
    const sum = await app.prisma.aiCallRecord.aggregate({
      where: { projectId: { in: projectIds }, ...CLINICAL_WRITING_AI, createdAt: { gte: start } },
      _sum:  { inputTokens: true, outputTokens: true, costUsd: true },
    })
    return {
      periodStart:    start.toISOString().slice(0, 10),
      projects:       projectIds.length,
      tokensConsumed: (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0),
      estimatedSpend: Math.round(Number(sum._sum.costUsd ?? 0) * 100) / 100,
      tenantName:     tenant?.name ?? null,      // the user's organisation, shown beside the date range
    }
  })
}
