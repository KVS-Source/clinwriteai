// Peer review routes — Module B (API contract §23).
//
// Flow:
//   1. Publication reaches 'submission' stage; journal returns comments.
//   2. POST /:pubId/review-rounds → opens round N with blank reviewer tabs.
//   3. POST /:pubId/review-rounds/:roundId/comments (batch) → seed with the
//      journal's reviewer letter (one row per comment-per-reviewer).
//   4. PATCH /round-comments/:commentId → fill response text, flip
//      status, maybe mark aiDrafted. Each save writes a new
//      ResponseLetterVersion snapshot.
//   5. POST /:pubId/review-rounds/:roundId/submit → locks the round.
//      Publication can advance stage back to 'submission' (R&R cycle)
//      or straight to 'published' at the journal's call.

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import type { PrismaClient } from '@prisma/client'

const openRoundSchema = z.object({
  journalSubmissionRef: z.string().min(1),
  reviewerCount: z.number().int().min(1).max(10).default(3),
})

const seedCommentsSchema = z.object({
  comments: z.array(z.object({
    reviewerTab: z.enum(['r1', 'r2', 'r3', 'ed']),
    commentNumber: z.number().int().positive(),
    commentText: z.string().min(1),
  })).min(1),
})

const patchCommentSchema = z.object({
  responseText: z.string().optional(),
  status: z.enum(['not_started', 'drafting', 'responded']).optional(),
  aiDrafted: z.boolean().optional(),
  aiModel: z.string().optional(),
}).refine(v => !v.aiDrafted || !!v.aiModel, {
  message: 'aiModel required when aiDrafted=true (Part 11 provenance)',
})

const submitRoundSchema = z.object({
  // Caller confirms submission to journal; letter version is auto-captured.
  journalMessageId: z.string().optional(),
})

export const peerReviewRoutes: FastifyPluginAsync = async (app) => {
  // --- Rounds ---------------------------------------------------------------

  app.get('/publications/:publicationId/review-rounds', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.peerReviewRound.findMany({
      where: { publicationId },
      orderBy: { roundNumber: 'asc' },
    })
  })

  app.post('/publications/:publicationId/review-rounds', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = openRoundSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    // Determine next round number (DB UNIQUE(publicationId, roundNumber)).
    const last = await app.prisma.peerReviewRound.findFirst({
      where: { publicationId },
      orderBy: { roundNumber: 'desc' },
    })
    if (last && !last.submittedAt) {
      return reply.code(409).send({
        error: 'open_round_exists',
        message: `Round ${last.roundNumber} is still open — submit it before opening a new one`,
        openRoundId: last.id,
      })
    }
    const roundNumber = (last?.roundNumber ?? 0) + 1

    const created = await app.prisma.peerReviewRound.create({
      data: {
        publicationId,
        roundNumber,
        journalSubmissionRef: parsed.data.journalSubmissionRef,
        reviewerCount: parsed.data.reviewerCount,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'peer_review_round_opened',
      entityType: 'publication',
      entityId: publicationId,
      details: { roundId: created.id, roundNumber, journalSubmissionRef: parsed.data.journalSubmissionRef },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // --- Comments -----------------------------------------------------------

  app.get('/publications/:publicationId/review-rounds/:roundId/comments', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, roundId } = request.params as { publicationId: string; roundId: string }
    const round = await app.prisma.peerReviewRound.findFirst({ where: { id: roundId, publicationId } })
    if (!round) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.reviewerComment.findMany({
      where: { roundId },
      orderBy: [{ reviewerTab: 'asc' }, { commentNumber: 'asc' }],
    })
  })

  app.post('/publications/:publicationId/review-rounds/:roundId/comments', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, roundId } = request.params as { publicationId: string; roundId: string }
    const parsed = seedCommentsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const round = await app.prisma.peerReviewRound.findFirst({ where: { id: roundId, publicationId } })
    if (!round) return reply.code(404).send({ error: 'not_found' })
    if (round.submittedAt) {
      return reply.code(409).send({ error: 'round_locked', message: 'Round already submitted; comments immutable' })
    }

    // createMany with duplicate (reviewer, number) would 409; we loop +
    // skipDuplicates so the batch is idempotent (safe to re-run if a
    // network blip killed the first attempt mid-way).
    const result = await app.prisma.reviewerComment.createMany({
      data: parsed.data.comments.map(c => ({
        roundId,
        reviewerTab: c.reviewerTab,
        commentNumber: c.commentNumber,
        commentText: c.commentText,
      })),
      skipDuplicates: true,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'peer_review_comments_seeded',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        roundId,
        attempted: parsed.data.comments.length,
        created: result.count,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({ created: result.count })
  })

  app.patch('/round-comments/:commentId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    const parsed = patchCommentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const comment = await app.prisma.reviewerComment.findUnique({
      where: { id: commentId },
      include: { round: true },
    })
    if (!comment) return reply.code(404).send({ error: 'not_found' })
    if (comment.round.submittedAt) {
      return reply.code(409).send({ error: 'round_locked' })
    }

    const now = new Date()
    const nextStatus = parsed.data.status ?? comment.status
    const transitioningToResponded = comment.status !== 'responded' && nextStatus === 'responded'

    const updateData: Parameters<typeof app.prisma.reviewerComment.update>[0]['data'] = {
      ...(parsed.data.responseText !== undefined && { responseText: parsed.data.responseText }),
      status: nextStatus,
      ...(parsed.data.aiDrafted !== undefined && { aiDrafted: parsed.data.aiDrafted }),
      ...(parsed.data.aiModel && {
        aiModel: parsed.data.aiModel,
        aiGeneratedAt: now,
        aiAcceptedBy: request.user!.id,
        aiAcceptedAt: now,
      }),
      ...(transitioningToResponded && {
        respondedBy: request.user!.id,
        respondedAt: now,
      }),
    }

    const updated = await app.prisma.reviewerComment.update({
      where: { id: commentId },
      data: updateData,
    })

    // Snapshot a new ResponseLetterVersion when the responded_count advances.
    // Non-responded edits don't bump — we only snapshot on completion.
    if (transitioningToResponded) {
      await snapshotLetterVersion(app.prisma, comment.roundId, request.user!.id)
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: parsed.data.aiDrafted ? 'peer_review_ai_response_accepted' : 'peer_review_comment_updated',
      entityType: 'publication',
      entityId: comment.round.publicationId,
      details: {
        roundId: comment.roundId,
        commentId,
        reviewerTab: comment.reviewerTab,
        toStatus: nextStatus,
        aiDrafted: parsed.data.aiDrafted ?? false,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- Letter versions ---------------------------------------------------

  app.get('/publications/:publicationId/review-rounds/:roundId/letter-versions', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, roundId } = request.params as { publicationId: string; roundId: string }
    const round = await app.prisma.peerReviewRound.findFirst({ where: { id: roundId, publicationId } })
    if (!round) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.responseLetterVersion.findMany({
      where: { roundId },
      orderBy: { createdAt: 'asc' },
    })
  })

  // --- Submit round ------------------------------------------------------

  app.post('/publications/:publicationId/review-rounds/:roundId/submit', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, roundId } = request.params as { publicationId: string; roundId: string }
    const parsed = submitRoundSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const round = await app.prisma.peerReviewRound.findFirst({
      where: { id: roundId, publicationId },
      include: { comments: true },
    })
    if (!round) return reply.code(404).send({ error: 'not_found' })
    if (round.submittedAt) return reply.code(409).send({ error: 'already_submitted' })

    // Submit gate: every comment must be 'responded'.
    const notResponded = round.comments.filter(c => c.status !== 'responded')
    if (notResponded.length > 0) {
      return reply.code(422).send({
        error: 'comments_pending',
        message: `${notResponded.length} comment(s) still awaiting response`,
        pendingCount: notResponded.length,
      })
    }

    const finalVersion = await app.prisma.$transaction(async (tx) => {
      const now = new Date()
      await tx.peerReviewRound.update({ where: { id: roundId }, data: { submittedAt: now } })
      return snapshotLetterVersion(tx as PrismaClient, roundId, request.user!.id, true)
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'peer_review_round_submitted',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        roundId,
        roundNumber: round.roundNumber,
        journalMessageId: parsed.data.journalMessageId ?? null,
        finalLetterVersion: finalVersion.letterVersion,
        contentHash: finalVersion.contentHash,
      },
      ipAddress: request.ip ?? null,
    })

    return finalVersion
  })
}

// --- helpers --------------------------------------------------------------

async function snapshotLetterVersion(
  prisma: PrismaClient,
  roundId: string,
  actorId: string,
  isFinal = false,
) {
  const comments = await prisma.reviewerComment.findMany({
    where: { roundId },
    orderBy: [{ reviewerTab: 'asc' }, { commentNumber: 'asc' }],
  })
  const total = comments.length
  const responded = comments.filter(c => c.status === 'responded').length

  // Letter content hashes a deterministic assembly: per-reviewer-tab,
  // comment number, comment text, response text. Order-stable so the
  // same state hashes identically across runs (binding target for
  // the e-sig chain if we extend Part 11 coverage here later).
  const h = createHash('sha256')
  for (const c of comments) {
    h.update(c.reviewerTab, 'utf8'); h.update('|', 'utf8')
    h.update(String(c.commentNumber), 'utf8'); h.update('|', 'utf8')
    h.update(c.commentText, 'utf8'); h.update('|', 'utf8')
    h.update(c.responseText, 'utf8'); h.update('|', 'utf8')
  }
  const contentHash = h.digest('hex')
  const letterVersion = isFinal ? `v1.${responded}-final` : `v1.${responded}`

  return prisma.responseLetterVersion.create({
    data: { roundId, letterVersion, respondedCount: responded, totalCount: total, contentHash, createdBy: actorId },
  })
}
