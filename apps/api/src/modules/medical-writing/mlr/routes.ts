// MLR review workflow routes — Module C (API contract §34-§35).
//
// Lifecycle slice this batch covers:
//   stage 4 (mlr_submission) → submit-to-mlr → stage 5 (mlr_review)
//   stage 5 → reviewer comments / per-reviewer decisions
//   stage 5 → MLR Lead final decision → stage 6 (approved, terminal)
//                                     OR stage 4 (needs_edit back to author)
//
// Gating:
//   - submit-to-mlr requires the latest PreMlrCheckResult.passed=true
//     (mustFixCount==0). Blocks the "ship it with 10 must-fix outstanding"
//     footgun.
//   - MLR Lead decision requires all assigned reviewers to have submitted
//     their individual decisions (per-reviewer decision ≠ final decision;
//     the Lead reconciles them).
//
// Part 11 note on `decide`: the request MUST include credential_proof
// (a client-generated token the real auth plugin will produce from a
// password re-auth + TOTP). For now the server accepts it as an opaque
// string and SHA-256s it. The real Part 11 shape ships when the
// e-signature decision in Compliance lands.

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const submitSchema = z.object({
  reviewerIds: z.array(z.string().min(1)).min(1, 'at least one reviewer required'),
})

const addCommentSchema = z.object({
  text: z.string().min(1),
  tag: z.enum(['Must Fix', 'Should Fix', 'Note']),
  escalatedFromAgentic: z.boolean().default(false),
})

const reviewerDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_edit']),
  note: z.string().optional(),
})

const leadDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_edit']),
  decisionNote: z.string().min(1, 'decision_note is required for Part 11'),
  meaning: z.string().min(1, 'meaning is required for Part 11 §11.50'),
  credentialProof: z.string().min(1, 'credentialProof token (password re-auth + MFA) required'),
})

export const mlrRoutes: FastifyPluginAsync = async (app) => {
  // --- Submit to MLR ------------------------------------------------------

  app.post('/:contentId/submit-to-mlr', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = submitSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.stage !== 4) {
      return reply.code(422).send({
        error: 'wrong_stage',
        message: `Content must be at stage 4 (mlr_submission) to submit; current: ${item.stage}`,
      })
    }

    // Pre-MLR gate: latest run must have passed (zero Must Fix).
    const latestPreMlr = await app.prisma.preMlrCheckResult.findFirst({
      where: { contentItemId: contentId },
      orderBy: { runAt: 'desc' },
    })
    if (!latestPreMlr || !latestPreMlr.passed) {
      return reply.code(422).send({
        error: 'pre_mlr_not_passed',
        message: 'Must have a passing Pre-MLR check (0 must-fix issues) before MLR submission.',
      })
    }

    // Assign reviewers + flip stage in one transaction. UNIQUE(contentItem,
    // user) catches duplicate reviewer attempts at the DB layer.
    const result = await app.prisma.$transaction(async (tx) => {
      const existingReviewers = await tx.mlrReviewer.findMany({
        where: { contentItemId: contentId },
      })
      // Idempotent re-submit: if the set of reviewers is identical and
      // the stage is already 5, we treat this as a no-op success.
      if (existingReviewers.length > 0 && item.stage === 5) {
        return { reviewers: existingReviewers, created: 0 }
      }
      // Fresh assignment path — resolve User rows for the role/name denorm.
      const users = await tx.user.findMany({ where: { id: { in: parsed.data.reviewerIds } } })
      const userById = new Map(users.map(u => [u.id, u]))
      const createdRows = await Promise.all(parsed.data.reviewerIds.map(async (uid) => {
        const u = userById.get(uid)
        return tx.mlrReviewer.upsert({
          where: { contentItemId_userId: { contentItemId: contentId, userId: uid } },
          create: {
            contentItemId: contentId,
            userId: uid,
            role: inferMlrRole(u?.role ?? 'reviewer'),
          },
          update: {},
        })
      }))
      await tx.medContentItem.update({
        where: { id: contentId },
        data: { stage: 5, status: 'in_mlr_review' },
      })
      return { reviewers: createdRows, created: createdRows.length }
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'submitted_to_mlr',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        reviewerCount: result.reviewers.length,
        reviewerIds: parsed.data.reviewerIds,
        preMlrRunId: latestPreMlr.id,
      },
      ipAddress: request.ip ?? null,
    })

    return { reviewers: result.reviewers, submittedAt: new Date().toISOString() }
  })

  // --- Reviewers list -----------------------------------------------------

  app.get('/:contentId/mlr-reviewers', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.mlrReviewer.findMany({
      where: { contentItemId: contentId },
      orderBy: { assignedAt: 'asc' },
    })
  })

  // Reviewer records their own per-reviewer decision. Does NOT advance
  // the stage — only the Lead's final decision does that.
  app.post('/:contentId/mlr-reviewers/self-decision', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = reviewerDecisionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.mlrReviewer.findUnique({
      where: { contentItemId_userId: { contentItemId: contentId, userId: request.user!.id } },
    })
    if (!row) return reply.code(403).send({ error: 'not_a_reviewer', message: 'Caller not assigned as an MLR reviewer on this item' })

    const updated = await app.prisma.mlrReviewer.update({
      where: { id: row.id },
      data: {
        decision: parsed.data.decision,
        decisionNote: parsed.data.note ?? null,
        submittedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'mlr_reviewer_decision_submitted',
      entityType: 'med_content',
      entityId: contentId,
      details: { reviewerId: row.id, role: row.role, decision: parsed.data.decision },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- MLR Comments -------------------------------------------------------

  app.get('/:contentId/mlr-comments', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.mlrComment.findMany({
      where: { contentItemId: contentId },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post('/:contentId/mlr-comments', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = addCommentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Reviewer-only: must be assigned to this content item.
    const reviewer = await app.prisma.mlrReviewer.findUnique({
      where: { contentItemId_userId: { contentItemId: contentId, userId: request.user!.id } },
    })
    if (!reviewer) {
      return reply.code(403).send({ error: 'not_a_reviewer', message: 'Only assigned MLR reviewers can comment' })
    }

    const id = await nextMlrCommentId(app.prisma, contentId)

    const created = await app.prisma.mlrComment.create({
      data: {
        id,
        contentItemId: contentId,
        reviewerId: request.user!.id,
        reviewerName: request.user!.email,                              // denorm fallback — User.name would be nicer but email always present
        text: parsed.data.text,
        tag: parsed.data.tag,
        escalatedFromAgentic: parsed.data.escalatedFromAgentic,
        ...(parsed.data.escalatedFromAgentic && {
          escalatedBy: request.user!.id,
          escalatedAt: new Date(),
        }),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: parsed.data.escalatedFromAgentic ? 'mlr_agentic_finding_escalated' : 'mlr_comment_added',
      entityType: 'med_content',
      entityId: contentId,
      details: { commentId: id, tag: parsed.data.tag, escalated: parsed.data.escalatedFromAgentic },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.patch('/:contentId/mlr-comments/:commentId/resolve', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId, commentId } = request.params as { contentId: string; commentId: string }
    const row = await app.prisma.mlrComment.findFirst({ where: { id: commentId, contentItemId: contentId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.resolvedAt) return reply.code(409).send({ error: 'already_resolved' })

    const updated = await app.prisma.mlrComment.update({
      where: { id: commentId },
      data: { resolvedAt: new Date(), resolvedBy: request.user!.id },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'mlr_comment_resolved',
      entityType: 'med_content',
      entityId: contentId,
      details: { commentId, tag: row.tag },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- MLR Lead final decision -------------------------------------------
  // Admin role gate stands in for MLR Lead role until that role catalogue
  // ships. See Phase 3C deferral memory.

  app.post('/:contentId/mlr-decision', { preHandler: requireAuth({ modules: ['C'], roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = leadDecideSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.stage !== 5) {
      return reply.code(422).send({ error: 'wrong_stage', message: `MLR decision requires stage 5 (mlr_review); current: ${item.stage}` })
    }

    // Gate: every assigned reviewer must have submitted their decision.
    const reviewers = await app.prisma.mlrReviewer.findMany({ where: { contentItemId: contentId } })
    const pending = reviewers.filter(r => !r.submittedAt)
    if (pending.length > 0) {
      return reply.code(422).send({
        error: 'reviewers_pending',
        message: `${pending.length} assigned reviewers haven't submitted decisions yet`,
        pending: pending.map(r => ({ id: r.id, userId: r.userId, role: r.role })),
      })
    }

    // Immutable Part 11 record. credentialProof is sha256'd — never stored
    // in plaintext.
    const credentialHash = createHash('sha256').update(parsed.data.credentialProof).digest('hex')

    // documentHash: for Phase 3C we hash a stable projection of the content
    // item (id + version + current fields). The final Compliance decision
    // on "what exactly is signed" (HTML? rendered PDF? JSON?) lands later;
    // this is a defensible interim.
    const documentHash = createHash('sha256')
      .update(item.id).update('|')
      .update(item.version).update('|')
      .update(item.title).update('|')
      .update(item.complianceTrack).update('|')
      .update(String(item.fkScore ?? '')).update('|')
      .update(item.reviewTier ?? '')
      .digest('hex')

    const decidedAt = new Date()
    const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } })

    const record = await app.prisma.$transaction(async (tx) => {
      const rec = await tx.mlrDecisionRecord.create({
        data: {
          contentItemId: contentId,
          decision: parsed.data.decision,
          decisionNote: parsed.data.decisionNote,
          decidedBy: request.user!.id,
          decidedByName: user?.name ?? request.user!.email,
          decidedByRole: user?.role ?? 'admin',
          meaning: parsed.data.meaning,
          credentialHash,
          documentHash,
          versionAtDecision: item.version,
          timestampUtc: decidedAt,
        },
      })

      // Transition content stage per the decision.
      if (parsed.data.decision === 'approved') {
        const now = new Date()
        const expiry = new Date(now)
        expiry.setMonth(expiry.getMonth() + 24)
        await tx.medContentItem.update({
          where: { id: contentId },
          data: { stage: 6, status: 'approved', approvedAt: now, expiryDate: expiry },
        })
      } else {
        // Rejected or needs_edit → back to stage 4 for the author to fix.
        await tx.medContentItem.update({
          where: { id: contentId },
          data: { stage: 4, status: parsed.data.decision === 'rejected' ? 'rejected' : 'needs_edit' },
        })
      }

      return rec
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'mlr_decision_recorded',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        recordId: record.id,
        decision: parsed.data.decision,
        meaning: parsed.data.meaning,
        documentHash,
        versionAtDecision: item.version,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(record)
  })

  app.get('/:contentId/mlr-decision/latest', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const latest = await app.prisma.mlrDecisionRecord.findFirst({
      where: { contentItemId: contentId },
      orderBy: { timestampUtc: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_decision_yet' })
    return latest
  })
}

// --- helpers --------------------------------------------------------------

async function nextMlrCommentId(prisma: import('@prisma/client').PrismaClient, contentItemId: string): Promise<string> {
  // Same per-entity sequential pattern as Module A comments (CMT-###).
  const rows = await prisma.mlrComment.findMany({
    where: { contentItemId, id: { startsWith: 'MLR-C-' } },
    select: { id: true },
  })
  const maxSeq = rows.reduce((max, r) => {
    const m = r.id.match(/^MLR-C-(\d+)$/)
    const n = m ? Number(m[1]) : 0
    return n > max ? n : max
  }, 0)
  return `MLR-C-${String(maxSeq + 1).padStart(3, '0')}`
}

function inferMlrRole(userRole: string): string {
  // Rough mapping from platform roles → MLR committee seats. Final role
  // catalogue lands with the MLR seat definition (Phase 3C deferral).
  if (userRole === 'medical-writer' || userRole === 'reviewer') return 'MLR Medical Reviewer'
  if (userRole === 'regulatory-writer') return 'MLR Regulatory Reviewer'
  if (userRole === 'admin' || userRole === 'super-admin') return 'MLR Lead'
  return 'MLR Reviewer'
}
