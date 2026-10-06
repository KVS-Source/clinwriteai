// Comments routes — Module A (API contract §5) + audit-trail scope (§6).
//
// Comments are reviewer feedback bound to a document + section. They use a
// human-readable application-generated id ("CMT-###") so reviewers can
// reference them in meeting notes and CRM discussions. The sequence is
// per-document — CMT-001 restarts for each document rather than being global.
//
// Comments are NEVER deleted; resolve-then-keep-the-record is the only
// mutation path. This is why resolve 409s on an already-resolved comment.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const addSchema = z.object({
  sectionRef: z.string().min(1),
  text: z.string().min(1),
  severity: z.enum(['major', 'minor', 'query']),
})

const resolveSchema = z.object({
  resolutionType: z.enum(['accept', 'accept_with_modification', 'reject']),
  note: z.string().min(1),
})

const listQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  sectionRef: z.string().optional(),
  severity: z.enum(['major', 'minor', 'query']).optional(),
})

// Shape comments for the UI's packages/types `Comment` interface. UI
// expects reviewerName + reviewerInitials (looked up from User) + age
// ("3 days ago"-style display string). Prisma stores only reviewerId
// + createdAt.
function formatAge(createdAt: Date): string {
  const diffMs = Date.now() - createdAt.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`
}

function commentShape(c: { reviewerId: string; createdAt: Date } & Record<string, unknown>, reviewer: { name: string; initials: string | null } | null) {
  return {
    ...c,
    reviewerName: reviewer?.name ?? c.reviewerId,
    reviewerInitials: reviewer?.initials ?? '',
    age: formatAge(c.createdAt),
  }
}

async function fetchCommentReviewers(prisma: import('@prisma/client').PrismaClient, rows: Array<{ reviewerId: string }>) {
  if (rows.length === 0) return new Map<string, { name: string; initials: string | null }>()
  const ids = Array.from(new Set(rows.map(r => r.reviewerId)))
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, initials: true } })
  return new Map(users.map(u => [u.id, { name: u.name, initials: u.initials }]))
}

export const commentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:documentId/comments', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.comment.findMany({
      where: {
        documentId,
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.sectionRef && { sectionRef: parsed.data.sectionRef }),
        ...(parsed.data.severity && { severity: parsed.data.severity }),
      },
      orderBy: { createdAt: 'desc' },
    })
    const reviewers = await fetchCommentReviewers(app.prisma, rows)
    return rows.map(r => commentShape(r, reviewers.get(r.reviewerId) ?? null))
  })

  app.post('/:documentId/comments', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = addSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const id = await nextCommentId(app.prisma, documentId)

    const created = await app.prisma.comment.create({
      data: {
        id,
        documentId,
        sectionRef: parsed.data.sectionRef,
        text: parsed.data.text,
        severity: parsed.data.severity,
        reviewerId: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'comment_added',
      entityType: 'document',
      entityId: documentId,
      details: {
        commentId: id,
        sectionRef: parsed.data.sectionRef,
        severity: parsed.data.severity,
      },
      ipAddress: request.ip ?? null,
    })

    const [reviewer] = await Promise.all([
      app.prisma.user.findUnique({ where: { id: created.reviewerId }, select: { name: true, initials: true } }),
    ])
    return reply.code(201).send(commentShape(created, reviewer))
  })

  app.patch('/:documentId/comments/:commentId/resolve', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, commentId } = request.params as { documentId: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const comment = await app.prisma.comment.findFirst({ where: { id: commentId, documentId } })
    if (!comment) return reply.code(404).send({ error: 'not_found' })
    if (comment.status === 'resolved') {
      return reply.code(409).send({ error: 'conflict', message: 'Comment already resolved' })
    }

    const updated = await app.prisma.comment.update({
      where: { id: commentId },
      data: {
        status: 'resolved',
        resolvedBy: request.user!.id,
        resolvedAt: new Date(),
        resolutionNote: `[${parsed.data.resolutionType}] ${parsed.data.note}`,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'comment_resolved',
      entityType: 'document',
      entityId: documentId,
      details: {
        commentId,
        resolutionType: parsed.data.resolutionType,
        sectionRef: comment.sectionRef,
      },
      ipAddress: request.ip ?? null,
    })

    const reviewer = await app.prisma.user.findUnique({ where: { id: updated.reviewerId }, select: { name: true, initials: true } })
    return commentShape(updated, reviewer)
  })

  // Document audit trail — reads from the hash-chained audit_events table
  // (ADR 0002). Scoped to the single document.
  app.get('/:documentId/audit', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.audit.listForEntity('document', documentId, 500)
    return rows
  })
}

async function nextCommentId(prisma: import('@prisma/client').PrismaClient, documentId: string): Promise<string> {
  // CMT-### is per-document and application-generated. We query the current
  // max then +1 — a race is tolerable because the Comment.id has a UNIQUE
  // constraint and the handler will 500 on the rare clash (test coverage
  // would be contrived; real reviewer concurrency per document is low).
  const latest = await prisma.comment.findMany({
    where: { documentId, id: { startsWith: 'CMT-' } },
    select: { id: true },
  })
  const maxSeq = latest.reduce((max, row) => {
    const m = row.id.match(/^CMT-(\d+)$/)
    const n = m ? Number(m[1]) : 0
    return n > max ? n : max
  }, 0)
  return `CMT-${String(maxSeq + 1).padStart(3, '0')}`
}
