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

// --- Shape helpers --------------------------------------------------------
//
// The UI's ODDAssessment is a composite view: it blends the clinical
// authoring data on OddAssessment with per-region prevalence calculations
// and parent-submission context (compound, taTag). The Prisma row stores
// only the raw clinical fields — everything else is derived.
//
// Region threshold math (standard definitions):
//   EU — orphan if prevalence ≤ 5 per 10,000 (= 50 per 100,000).
//        Patient estimate uses EU-27 population ~448M.
//   US — orphan if fewer than 200,000 patients in the US (~331M population).
//        Equivalent to prevalence < ~60.4 per 100,000.
// prevalenceScore (0-100) is clamped from prevalencePer100k so lower
// (rarer) numbers score higher; eligibilityScore combines EU + US
// eligibility into a 0-100 scalar for the dashboard chip.

const EU_POP = 448_000_000
const US_POP = 331_000_000
const EU_THRESHOLD_PER_100K = 50     // 5 per 10,000
const US_PATIENT_CAP = 200_000

function oddAssessmentShape(
  a: {
    id: string
    submissionId: string
    diseaseIndication: string
    prevalencePer100k: import('@prisma/client/runtime/library').Decimal
    medicalNeedJustification: string
    significantBenefit: string | null
    status: string
    completedAt: Date | null
    createdAt: Date
  },
  context: { projectId: string; compound: string; taTag: string },
) {
  const prevalence = Number(a.prevalencePer100k.toString())
  const euPatients = Math.round(prevalence * (EU_POP / 100_000))
  const usPatients = Math.round(prevalence * (US_POP / 100_000))
  const euMeets = prevalence <= EU_THRESHOLD_PER_100K
  const usMeets = usPatients < US_PATIENT_CAP

  // prevalenceScore: 100 when prevalencePer100k ≤ 1, 0 when ≥ 100.
  // Linear in between — a quick-to-read rarity bar.
  const prevalenceScore = Math.max(0, Math.min(100, Math.round(100 - prevalence)))

  const eligibilityScore = (euMeets ? 50 : 0) + (usMeets ? 50 : 0)
  const eligibilityLabel =
    eligibilityScore === 100 ? 'Both regions eligible'
      : eligibilityScore === 50 ? 'Partial eligibility'
        : 'Not eligible'

  const benefitDraftStatus: 'clinical-lead-pending' | 'clinical-lead-signed' =
    a.status === 'approved' ? 'clinical-lead-signed' : 'clinical-lead-pending'

  // benefitDraft is the human-authored narrative — join medicalNeed with
  // the optional significantBenefit paragraph when present.
  const benefitDraft = a.significantBenefit
    ? `${a.medicalNeedJustification}\n\n${a.significantBenefit}`
    : a.medicalNeedJustification

  return {
    id: a.id,
    submissionId: a.submissionId,
    projectId: context.projectId,
    compound: context.compound,
    indication: a.diseaseIndication,
    taTag: context.taTag,
    prevalenceScore,
    eu: {
      prevalence: `${prevalence.toFixed(2)} per 100,000`,
      threshold: '≤ 5 per 10,000 (= 50 per 100,000)',
      meetsThreshold: euMeets,
      patientEstimate: `~${euPatients.toLocaleString('en-US')} patients (EU-27)`,
      status: euMeets ? 'Eligible for EU orphan designation' : 'Above EU prevalence threshold',
    },
    us: {
      prevalencePatients: usPatients,
      threshold: `< ${US_PATIENT_CAP.toLocaleString('en-US')} US patients`,
      meetsThreshold: usMeets,
      status: usMeets ? 'Eligible for US orphan designation' : 'Above US patient cap',
    },
    eligibilityScore,
    eligibilityLabel,
    benefitDraft,
    benefitDraftStatus,
    clinicalLeadSignedAt: a.status === 'approved' && a.completedAt ? a.completedAt.toISOString() : null,
    generatedAt: a.createdAt.toISOString(),
  }
}

// Batch fetch submission → source project context. The compound field
// isn't a column on RegulatorySubmission (same situation as Batch 40's
// submissionShape); we synthesise it from the source Module A project's
// `indication`. Two queries total regardless of list size.
async function fetchOddContext(
  prisma: import('@prisma/client').PrismaClient,
  submissionIds: ReadonlyArray<string>,
): Promise<Map<string, { projectId: string; compound: string; taTag: string }>> {
  if (submissionIds.length === 0) return new Map()
  const subs = await prisma.regulatorySubmission.findMany({
    where: { id: { in: Array.from(new Set(submissionIds)) } },
    select: { id: true, projectId: true, sourceModuleAProjectId: true, taTag: true },
  })
  const srcProjectIds = Array.from(new Set(subs.map(s => s.sourceModuleAProjectId).filter(Boolean)))
  const srcProjects = srcProjectIds.length > 0
    ? await prisma.project.findMany({
      where: { id: { in: srcProjectIds } },
      select: { id: true, indication: true },
    })
    : []
  const indicationById = new Map(srcProjects.map(p => [p.id, p.indication ?? '']))
  return new Map(subs.map(s => [s.id, {
    projectId: s.projectId,
    compound: indicationById.get(s.sourceModuleAProjectId) ?? '',
    taTag: s.taTag,
  }]))
}

export const oddRoutes: FastifyPluginAsync = async (app) => {
  app.get('/regulatory-submissions/:submissionId/odd', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.oddAssessment.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
    })
    const context = await fetchOddContext(app.prisma, [submissionId])
    const ctx = context.get(submissionId) ?? { projectId: sub.projectId, compound: '', taTag: sub.taTag }
    return rows.map(r => oddAssessmentShape(r, ctx))
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
    const context = await fetchOddContext(app.prisma, [submissionId])
    const ctx = context.get(submissionId) ?? { projectId: sub.projectId, compound: '', taTag: sub.taTag }
    return reply.code(201).send(oddAssessmentShape(created, ctx))
  })

  app.get('/odd/:assessmentId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    const context = await fetchOddContext(app.prisma, [a.submissionId])
    const ctx = context.get(a.submissionId) ?? { projectId: '', compound: '', taTag: '' }
    return oddAssessmentShape(a, ctx)
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
    const updated = await app.prisma.oddAssessment.update({ where: { id: assessmentId }, data: parsed.data })
    const context = await fetchOddContext(app.prisma, [a.submissionId])
    const ctx = context.get(a.submissionId) ?? { projectId: '', compound: '', taTag: '' }
    return oddAssessmentShape(updated, ctx)
  })

  app.post('/odd/:assessmentId/submit-for-review', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string }
    const a = await app.prisma.oddAssessment.findUnique({ where: { id: assessmentId } })
    if (!a) return reply.code(404).send({ error: 'not_found' })
    if (a.status !== 'draft') {
      return reply.code(409).send({ error: 'wrong_status' })
    }
    const updated = await app.prisma.oddAssessment.update({ where: { id: assessmentId }, data: { status: 'under_review' } })
    const context = await fetchOddContext(app.prisma, [a.submissionId])
    const ctx = context.get(a.submissionId) ?? { projectId: '', compound: '', taTag: '' }
    return oddAssessmentShape(updated, ctx)
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

    const context = await fetchOddContext(app.prisma, [a.submissionId])
    const ctx = context.get(a.submissionId) ?? { projectId: '', compound: '', taTag: '' }
    return oddAssessmentShape(updated, ctx)
  })
}
