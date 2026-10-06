// Module D HA correspondence routes — post-submission authority round-trip.
//
// Source: 02-datamodel.md §53, 03-api-contract.md §52 (DD-D-004).
// Lifecycle: inbound LoQ → questions extracted → drafts generated →
// drafts approved → outbound response letter → authority ack/approval/nack.
//
// Gated to submissions at stage 6+ — pre-submission authority correspondence
// is a different workflow (pre-IND meetings, Type C questions, etc.) not
// covered here.
//
// Mixed path shapes (submission-scoped, correspondence-scoped, question-scoped
// and draft-scoped), registered at root like crm/tlf/signatures/peer-review.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const loqSchema = z.object({
  contentSummary: z.string().min(1),
  receivedAt: z.string().datetime(),
  loqDocId: z.string().optional(),               // blob key if the LoQ PDF is uploaded
  questions: z.array(z.object({
    questionRef: z.string().min(1),              // 'Q1', 'Q2.3'
    questionText: z.string().min(1),
    category: z.enum(['cmc', 'clinical', 'nonclinical', 'labeling', 'other']).optional(),
    sourceModuleRef: z.string().optional(),      // 'Module 3.2.P.3'
    dueDate: z.string().datetime().optional(),
  })).min(1, 'at least one question required'),
})

const draftSchema = z.object({
  draftText: z.string().min(1),
  sourceRefs: z.array(z.string()).default([]),
  aiFootprintPct: z.number().int().min(0).max(100).optional(),
})

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewNote: z.string().optional(),
})

const closeSchema = z.object({
  contentSummary: z.string().min(1),             // one-line summary of the compiled response
  responseDocId: z.string().optional(),
})

const authorityReplySchema = z.object({
  type: z.enum(['ack', 'approval', 'nack']),
  contentSummary: z.string().min(1),
  receivedAt: z.string().datetime(),
})

// --- Shape helpers --------------------------------------------------------
//
// UI vs Prisma divergence for the Module D HA correspondence trio is wide
// enough that each sub-resource needs its own helper.
//
// HAQuestion: Prisma stores a richer question row (questionRef, category
// including nonclinical/labeling/other, status open/drafting/approved/closed)
// than the UI consumes. The UI's HAQuestion collapses:
//   - category → {clinical | cmc | administrative} (anything that isn't
//     clinical or cmc becomes 'administrative' for display grouping)
//   - status   → {not-started | in-progress | responded} (open=not-started,
//     drafting=in-progress, approved/closed=responded)
//   - number   → parsed from questionRef ('Q1' → 1, 'Q2.3' → 2)
//   - aiDraftGenerated + aiFootprintPct → derived from the latest draft row
//   - assignedTo / assignedRole → not persisted; defaulted ('', '')
//
// HACorrespondence: UI expects a `gateway` field that isn't stored on the
// correspondence row — it's a submission-wide property. We pull the parent
// submission's first targetHAs entry as the display gateway. loqDocTitle
// stays undefined (would need a BlobStorage metadata lookup to populate).
// questionsExtracted + questionsCategories come from the already-loaded
// questions relation when present.

const HA_STATUS_TO_UI: Record<string, 'not-started' | 'in-progress' | 'responded'> = {
  open: 'not-started',
  drafting: 'in-progress',
  approved: 'responded',
  closed: 'responded',
}

const HA_CATEGORY_TO_UI = (prismaCat: string | null): 'clinical' | 'cmc' | 'administrative' => {
  if (prismaCat === 'clinical') return 'clinical'
  if (prismaCat === 'cmc') return 'cmc'
  return 'administrative'
}

type HaQuestionShapeInput = {
  id: string
  questionRef: string
  questionText: string
  category: string | null
  status: string
  responseAt: Date | null
  drafts?: Array<{ aiFootprintPct: number | null; versionNumber: number }>
}

function haQuestionShape(q: HaQuestionShapeInput) {
  // Parse the leading integer out of 'Q1', 'Q2.3', '12', etc. Falls back
  // to 0 so sorting in the UI stays stable even for odd refs.
  const numMatch = q.questionRef.match(/\d+/)
  const number = numMatch ? Number(numMatch[0]) : 0
  // Latest draft wins (drafts list is newest-first when provided).
  const latestDraft = q.drafts?.[0] ?? null
  return {
    questionId: q.id,
    number,
    category: HA_CATEGORY_TO_UI(q.category),
    text: q.questionText,
    assignedTo: '',
    assignedRole: '',
    status: HA_STATUS_TO_UI[q.status] ?? 'not-started',
    respondedAt: q.responseAt ? q.responseAt.toISOString() : null,
    aiDraftGenerated: !!latestDraft,
    aiFootprintPct: latestDraft?.aiFootprintPct ?? null,
  }
}

type HaCorrespondenceShapeInput = {
  id: string
  submissionId: string
  direction: string
  type: string
  contentSummary: string
  receivedAt: Date | null
  respondedAt: Date | null
  loqDocId: string | null
  responseDocId: string | null
  questions?: HaQuestionShapeInput[]
}

function haCorrespondenceShape(
  c: HaCorrespondenceShapeInput,
  gateway: string,
) {
  const questions = c.questions ? c.questions.map(haQuestionShape) : undefined
  // Categorical breakdown — only computed when the questions list is loaded.
  const questionsCategories = questions ? questions.reduce(
    (acc, q) => {
      acc[q.category]++
      return acc
    },
    { clinical: 0, cmc: 0, administrative: 0 } as { clinical: number; cmc: number; administrative: number },
  ) : undefined
  return {
    id: c.id,
    submissionId: c.submissionId,
    direction: c.direction as 'inbound' | 'outbound',
    type: c.type as 'loq' | 'response' | 'ack' | 'approval' | 'nack',
    gateway,
    contentSummary: c.contentSummary,
    receivedAt: c.receivedAt ? c.receivedAt.toISOString() : null,
    respondedAt: c.respondedAt ? c.respondedAt.toISOString() : null,
    loqDocId: c.loqDocId,
    responsePkgDocId: c.responseDocId,
    questionsExtracted: questions?.length,
    questionsCategories,
    questions,
  }
}

// Resolve display gateway for a submission (first targetHAs entry, or
// 'fda-esg' as a safe default). Batched for list routes.
async function fetchSubmissionGateways(
  prisma: import('@prisma/client').PrismaClient,
  submissionIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (submissionIds.length === 0) return new Map()
  const rows = await prisma.regulatorySubmission.findMany({
    where: { id: { in: Array.from(new Set(submissionIds)) } },
    select: { id: true, targetHas: true },
  })
  return new Map(rows.map(r => [r.id, (r.targetHas?.[0] ?? 'fda-esg')]))
}

export const haCorrespondenceRoutes: FastifyPluginAsync = async (app) => {
  // --- LoQ ingest (inbound) -----------------------------------------------

  app.post('/regulatory-submissions/:submissionId/ha-correspondence/loq', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = loqSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    if (sub.stage < 6) {
      return reply.code(422).send({
        error: 'pre_submission',
        message: `HA correspondence requires submission at stage 6+ (current: ${sub.stage})`,
      })
    }

    // Reject dupes by questionRef within the same LoQ at the input layer so
    // we don't eat an opaque Prisma unique-violation error.
    const refs = new Set<string>()
    for (const q of parsed.data.questions) {
      if (refs.has(q.questionRef)) {
        return reply.code(400).send({ error: 'duplicate_question_ref', questionRef: q.questionRef })
      }
      refs.add(q.questionRef)
    }

    const created = await app.prisma.$transaction(async (tx) => {
      const corr = await tx.haCorrespondence.create({
        data: {
          submissionId,
          direction: 'inbound',
          type: 'loq',
          contentSummary: parsed.data.contentSummary,
          receivedAt: new Date(parsed.data.receivedAt),
          loqDocId: parsed.data.loqDocId,
        },
      })
      await tx.haLoqQuestion.createMany({
        data: parsed.data.questions.map(q => ({
          correspondenceId: corr.id,
          questionRef: q.questionRef,
          questionText: q.questionText,
          category: q.category,
          sourceModuleRef: q.sourceModuleRef,
          dueDate: q.dueDate ? new Date(q.dueDate) : null,
        })),
      })
      return corr
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ha_loq_uploaded',
      entityType: 'regulatory_submission',
      entityId: submissionId,
      details: {
        correspondenceId: created.id,
        questionCount: parsed.data.questions.length,
        loqDocId: parsed.data.loqDocId ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    const withQuestions = await app.prisma.haCorrespondence.findUniqueOrThrow({
      where: { id: created.id },
      include: { questions: { orderBy: { questionRef: 'asc' } } },
    })
    const gateway = sub.targetHas?.[0] ?? 'fda-esg'
    return reply.code(201).send(haCorrespondenceShape(withQuestions, gateway))
  })

  // --- Listing + detail --------------------------------------------------

  app.get('/regulatory-submissions/:submissionId/ha-correspondence', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.haCorrespondence.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
      include: { questions: { orderBy: { questionRef: 'asc' } } },
    })
    const gateway = sub.targetHas?.[0] ?? 'fda-esg'
    return rows.map(r => haCorrespondenceShape(r, gateway))
  })

  app.get('/ha-correspondence/:correspondenceId', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { correspondenceId } = request.params as { correspondenceId: string }
    const corr = await app.prisma.haCorrespondence.findUnique({
      where: { id: correspondenceId },
      include: {
        questions: {
          orderBy: { questionRef: 'asc' },
          include: { drafts: { orderBy: { versionNumber: 'desc' } } },
        },
      },
    })
    if (!corr) return reply.code(404).send({ error: 'not_found' })
    const gateways = await fetchSubmissionGateways(app.prisma, [corr.submissionId])
    return haCorrespondenceShape(corr, gateways.get(corr.submissionId) ?? 'fda-esg')
  })

  // --- Draft response for a question -------------------------------------

  app.post('/ha-questions/:questionId/drafts', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { questionId } = request.params as { questionId: string }
    const parsed = draftSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const question = await app.prisma.haLoqQuestion.findUnique({ where: { id: questionId } })
    if (!question) return reply.code(404).send({ error: 'not_found' })
    if (question.status === 'closed') {
      return reply.code(409).send({ error: 'question_closed', message: 'Cannot draft against a closed question' })
    }

    // Monotonic versionNumber per question. UNIQUE(questionId, versionNumber)
    // is the real guard; app-layer just picks the next.
    const latest = await app.prisma.haResponseDraft.findFirst({
      where: { questionId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    const nextVersion = (latest?.versionNumber ?? 0) + 1

    const draft = await app.prisma.$transaction(async (tx) => {
      const d = await tx.haResponseDraft.create({
        data: {
          questionId,
          versionNumber: nextVersion,
          draftText: parsed.data.draftText,
          sourceRefs: parsed.data.sourceRefs,
          aiFootprintPct: parsed.data.aiFootprintPct,
          createdBy: request.user!.id,
        },
      })
      // Flip question to 'drafting' if it was 'open'.
      await tx.haLoqQuestion.updateMany({
        where: { id: questionId, status: 'open' },
        data: { status: 'drafting' },
      })
      return d
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ha_response_generated',
      entityType: 'ha_question',
      entityId: questionId,
      details: { draftId: draft.id, versionNumber: nextVersion, aiFootprintPct: parsed.data.aiFootprintPct ?? null },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(draft)
  })

  // --- Review a draft (approve or reject) --------------------------------

  app.patch('/ha-drafts/:draftId/review', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { draftId } = request.params as { draftId: string }
    const parsed = reviewSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const draft = await app.prisma.haResponseDraft.findUnique({
      where: { id: draftId },
      include: { question: true },
    })
    if (!draft) return reply.code(404).send({ error: 'not_found' })
    if (draft.status === 'approved' || draft.status === 'rejected') {
      return reply.code(409).send({ error: 'already_reviewed', currentStatus: draft.status })
    }

    const now = new Date()
    await app.prisma.$transaction(async (tx) => {
      await tx.haResponseDraft.update({
        where: { id: draftId },
        data: {
          status: parsed.data.decision,
          reviewedBy: request.user!.id,
          reviewedAt: now,
          reviewNote: parsed.data.reviewNote,
        },
      })
      // Approved draft advances the question to 'approved'. Rejection
      // leaves the question in 'drafting' (writer must produce a new draft).
      if (parsed.data.decision === 'approved') {
        await tx.haLoqQuestion.update({
          where: { id: draft.questionId },
          data: { status: 'approved', responseAt: now },
        })
      }
    })

    return app.prisma.haResponseDraft.findUnique({ where: { id: draftId } })
  })

  // --- Compile outbound response letter ----------------------------------

  app.post('/regulatory-submissions/:submissionId/ha-correspondence/:correspondenceId/response', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId, correspondenceId } = request.params as { submissionId: string; correspondenceId: string }
    const parsed = closeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const corr = await app.prisma.haCorrespondence.findUnique({
      where: { id: correspondenceId },
      include: { questions: true },
    })
    if (!corr) return reply.code(404).send({ error: 'not_found' })
    if (corr.submissionId !== submissionId) {
      return reply.code(400).send({ error: 'submission_mismatch' })
    }
    if (corr.type !== 'loq' || corr.direction !== 'inbound') {
      return reply.code(422).send({ error: 'not_a_loq', message: 'Response can only be issued against an inbound LoQ' })
    }
    if (corr.respondedAt) {
      return reply.code(409).send({ error: 'already_responded' })
    }
    const unapproved = corr.questions.filter(q => q.status !== 'approved' && q.status !== 'closed')
    if (unapproved.length > 0) {
      return reply.code(422).send({
        error: 'questions_unapproved',
        message: `${unapproved.length} question(s) still require an approved draft`,
        unapprovedRefs: unapproved.map(q => q.questionRef),
      })
    }

    const now = new Date()
    const response = await app.prisma.$transaction(async (tx) => {
      // Create the outbound response row linked by submissionId. Not a child
      // of the LoQ to keep direction symmetric with authority replies below.
      const resp = await tx.haCorrespondence.create({
        data: {
          submissionId,
          direction: 'outbound',
          type: 'response',
          contentSummary: parsed.data.contentSummary,
          respondedAt: now,
          responseDocId: parsed.data.responseDocId,
        },
      })
      // Stamp the inbound LoQ as responded; freeze its questions as 'closed'.
      await tx.haCorrespondence.update({
        where: { id: correspondenceId },
        data: { respondedAt: now, responseDocId: parsed.data.responseDocId },
      })
      await tx.haLoqQuestion.updateMany({
        where: { correspondenceId, status: 'approved' },
        data: { status: 'closed' },
      })
      return resp
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'ha_response_signed',
      entityType: 'regulatory_submission',
      entityId: submissionId,
      details: {
        loqCorrespondenceId: correspondenceId,
        responseCorrespondenceId: response.id,
        questionCount: corr.questions.length,
      },
      ipAddress: request.ip ?? null,
    })

    const gateways = await fetchSubmissionGateways(app.prisma, [submissionId])
    return reply.code(201).send(haCorrespondenceShape(response, gateways.get(submissionId) ?? 'fda-esg'))
  })

  // --- Authority reply (ack / approval / nack) ---------------------------

  app.post('/regulatory-submissions/:submissionId/ha-correspondence/authority-reply', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = authorityReplySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.haCorrespondence.create({
      data: {
        submissionId,
        direction: 'inbound',
        type: parsed.data.type,
        contentSummary: parsed.data.contentSummary,
        receivedAt: new Date(parsed.data.receivedAt),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: `ha_${parsed.data.type}_received`,
      entityType: 'regulatory_submission',
      entityId: submissionId,
      details: { correspondenceId: created.id, type: parsed.data.type },
      ipAddress: request.ip ?? null,
    })

    const gateway = sub.targetHas?.[0] ?? 'fda-esg'
    return reply.code(201).send(haCorrespondenceShape(created, gateway))
  })
}
