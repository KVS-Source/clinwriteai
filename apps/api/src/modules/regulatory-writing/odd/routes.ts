// Module D orphan drug designation (ODD) assessments.
//
// Lifecycle:
//   draft → under_review → approved | rejected | withdrawn
//
// Approval records the issuing authority + designation number
// (e.g. 'ODD-2026-0417') + approvalDate. Rejection records a reason.
// Audit event 'odd_assessment_completed' is emitted on terminal transitions.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  diseaseIndication: z.string().min(1),
  prevalencePer100k: z.number().positive(),
  medicalNeedJustification: z.string().min(1),
  significantBenefit: z.string().optional(),
})

const updateSchema = z.object({
  diseaseIndication: z.string().optional(),
  prevalencePer100k: z.number().positive().optional(),
  medicalNeedJustification: z.string().optional(),
  significantBenefit: z.string().optional(),
})

const outcomeSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approved'),
    issuingAuthority: z.enum(['FDA', 'EMA', 'MHRA', 'PMDA', 'CDSCO']),
    designationNumber: z.string().min(1),
    approvalDate: z.string().datetime(),
  }),
  z.object({
    decision: z.literal('rejected'),
    rejectionReason: z.string().min(1),
  }),
  z.object({
    decision: z.literal('withdrawn'),
    reason: z.string().optional(),
  }),
])

export const oddRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regulatory-submissions/:submissionId/odd', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.oddAssessment.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
    })
  })

  app.post('/regulatory-submissions/:submissionId/odd', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.oddAssessment.create({
      data: {
        submissionId,
        diseaseIndication: parsed.data.diseaseIndication,
        prevalencePer100k: parsed.data.prevalencePer100k,
        medicalNeedJustification: parsed.data.medicalNeedJustification,
        significantBenefit: parsed.data.significantBenefit,
      },
    })
    return reply.code(201).send(created)
  })

  app.get('/odd/:assessmentId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    return a
  })

  app.patch('/odd/:assessmentId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    if (['approved', 'rejected', 'withdrawn'].includes(a.status)) {
      return reply.code(409).send({ error: 'frozen', message: `Cannot edit ${a.status} assessment` })
    }
    return app.prisma.oddAssessment.update({ where: { id: assessmentId }, data: parsed.data })
  })

  app.post('/odd/:assessmentId/submit-for-review', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    if (a.status !== 'draft') {
      return reply.code(409).send({ error: 'wrong_status' })
    }
    return app.prisma.oddAssessment.update({ where: { id: assessmentId }, data: { status: 'under_review' } })
  })

  app.post('/odd/:assessmentId/outcome', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const parsed = outcomeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    if (['approved', 'rejected', 'withdrawn'].includes(a.status)) {
      return reply.code(409).send({ error: 'already_terminal', currentStatus: a.status })
    }

    const now = new Date()
    const updateData: Record<string, unknown> = {
      status: parsed.data.decision,
      completedBy: request.user!.id,
      completedAt: now,
    }
    if (parsed.data.decision === 'approved') {
      updateData.issuingAuthority = parsed.data.issuingAuthority
      updateData.designationNumber = parsed.data.designationNumber
      updateData.approvalDate = new Date(parsed.data.approvalDate)
    } else if (parsed.data.decision === 'rejected') {
      updateData.rejectionReason = parsed.data.rejectionReason
    } else if (parsed.data.decision === 'withdrawn' && parsed.data.reason) {
      updateData.rejectionReason = parsed.data.reason
    }

    const updated = await app.prisma.oddAssessment.update({
      where: { id: assessmentId },
      data: updateData,
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'odd_assessment_completed',
      entityType: 'odd_assessment',
      entityId: assessmentId,
      details: {
        submissionId: a.submissionId,
        decision: parsed.data.decision,
        designationNumber: parsed.data.decision === 'approved' ? parsed.data.designationNumber : null,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
