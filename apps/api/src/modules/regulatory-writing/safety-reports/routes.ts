// Module D aggregate safety reports — PSUR / PBRER authoring surface (FR-D-015).
//
// Source: 04-acceptance-criteria.md AC-D-015, ICH E2C(R2).
//
// Lifecycle:
//   draft → under_review → signed
//
// The AC-D-015 verification gate: 'signed' requires a non-null
// pvLeadVerifiedAt. The route sets both pvLeadVerifiedBy + pvLeadVerifiedAt
// atomically during /verify so there's no state where a report is
// signed-but-unverified.
//
// AE line-list wiring deferred until MedDRA licensing clears — the body
// columns here (signalSummary, benefitRiskSummary) are HTML and carry
// an aiFootprintPct for the AC-D-015 UI indicator.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  reportType: z.enum(['psur', 'pbrer']),
  reportingPeriodStart: z.string().datetime(),
  reportingPeriodEnd: z.string().datetime(),
  dataLockPoint: z.string().datetime(),
  signalSummary: z.string().default(''),
  benefitRiskSummary: z.string().default(''),
  aiFootprintPct: z.number().int().min(0).max(100).optional(),
})

const updateSchema = z.object({
  signalSummary: z.string().optional(),
  benefitRiskSummary: z.string().optional(),
  aiFootprintPct: z.number().int().min(0).max(100).optional(),
})

const verifySchema = z.object({
  verificationNote: z.string().min(1, 'PV Lead must record verification note'),
})

export const safetyReportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regulatory-submissions/:submissionId/safety-reports', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.aggregateSafetyReport.findMany({
      where: { submissionId },
      orderBy: { generatedAt: 'desc' },
    })
  })

  app.post('/regulatory-submissions/:submissionId/safety-reports', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const start = new Date(parsed.data.reportingPeriodStart)
    const end = new Date(parsed.data.reportingPeriodEnd)
    const dlp = new Date(parsed.data.dataLockPoint)
    if (end <= start) return reply.code(400).send({ error: 'invalid_period', message: 'reportingPeriodEnd must be after start' })
    if (dlp < end) return reply.code(400).send({ error: 'invalid_dlp', message: 'dataLockPoint must be ≥ reportingPeriodEnd' })

    const created = await app.prisma.aggregateSafetyReport.create({
      data: {
        submissionId,
        reportType: parsed.data.reportType,
        reportingPeriodStart: start,
        reportingPeriodEnd: end,
        dataLockPoint: dlp,
        signalSummary: parsed.data.signalSummary,
        benefitRiskSummary: parsed.data.benefitRiskSummary,
        aiFootprintPct: parsed.data.aiFootprintPct,
        generatedBy: request.user!.id,
      },
    })
    return reply.code(201).send(created)
  })

  app.get('/safety-reports/:reportId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string }
    const r = await app.prisma.aggregateSafetyReport.findUnique({ where: { id: reportId } })
    if (!r) return reply.code(404).send({ error: 'not_found' })
    return r
  })

  app.patch('/safety-reports/:reportId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const r = await app.prisma.aggregateSafetyReport.findUnique({ where: { id: reportId } })
    if (!r) return reply.code(404).send({ error: 'not_found' })
    if (r.status === 'signed' || r.status === 'submitted') {
      return reply.code(409).send({ error: 'frozen', message: `Cannot edit a ${r.status} report` })
    }
    return app.prisma.aggregateSafetyReport.update({ where: { id: reportId }, data: parsed.data })
  })

  // --- PV Lead verification (AC-D-015 gate) ------------------------------

  app.post('/safety-reports/:reportId/verify', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string }
    const parsed = verifySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const r = await app.prisma.aggregateSafetyReport.findUnique({ where: { id: reportId } })
    if (!r) return reply.code(404).send({ error: 'not_found' })
    if (r.status !== 'draft' && r.status !== 'under_review') {
      return reply.code(409).send({ error: 'wrong_status' })
    }

    const now = new Date()
    const verified = await app.prisma.aggregateSafetyReport.update({
      where: { id: reportId },
      data: {
        status: 'under_review',
        pvLeadVerifiedBy: request.user!.id,
        pvLeadVerifiedAt: now,
        pvLeadVerificationNote: parsed.data.verificationNote,
      },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'safety_report_pv_verified',
      entityType: 'aggregate_safety_report',
      entityId: reportId,
      details: { reportType: r.reportType, submissionId: r.submissionId },
      ipAddress: request.ip ?? null,
    })
    return verified
  })

  // --- Sign (final sign-off; AC-D-015 gate — requires prior PV verify) ---

  app.post('/safety-reports/:reportId/sign', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string }
    const r = await app.prisma.aggregateSafetyReport.findUnique({ where: { id: reportId } })
    if (!r) return reply.code(404).send({ error: 'not_found' })
    if (r.status === 'signed' || r.status === 'submitted') {
      return reply.code(409).send({ error: 'already_signed' })
    }
    if (!r.pvLeadVerifiedAt) {
      return reply.code(422).send({
        error: 'pv_not_verified',
        message: 'PV Lead verification required before sign-off (AC-D-015)',
      })
    }

    const now = new Date()
    const signed = await app.prisma.aggregateSafetyReport.update({
      where: { id: reportId },
      data: { status: 'signed', submittedAt: now },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'safety_report_signed',
      entityType: 'aggregate_safety_report',
      entityId: reportId,
      details: { reportType: r.reportType, submissionId: r.submissionId },
      ipAddress: request.ip ?? null,
    })
    return signed
  })
}
