// Publication section comment routes — Phase M-B.5.
//
// Flat + optional threading (parentCommentId). Role gates:
//   - Create: R / A / C authors (+ admin / scoped PM)
//   - Read: any authenticated user with Module B access
//   - Resolve: R / A authors + the original commenter (+ admin / scoped PM)
//
// On create, mentionedUserIds fire 'publication.comment_mention'
// notifications via the shared NotificationService.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  actorCanCommentOnPublication,
  actorCanEditPublicationContent,
  PUBLICATION_COMMENT_FORBIDDEN,
  PUBLICATION_EDIT_FORBIDDEN,
} from './access/publication-raci.js'

const gate      = requireAuth({ modules: ['B'] })
const writeGate = requireAuth({ modules: ['B'] })

const createSchema = z.object({
  text:             z.string().trim().min(1).max(5000),
  severity:         z.enum(['info', 'warning', 'blocking']).optional(),
  parentCommentId:  z.string().optional(),
  mentionedUserIds: z.array(z.string().min(1)).max(20).optional(),
})

const resolveSchema = z.object({
  resolutionNote: z.string().max(2000).optional(),
})

function shapeComment(row: {
  id: string; publicationId: string; sectionId: string
  authorId: string; authorName: string
  text: string; severity: string; status: string
  resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
  parentCommentId: string | null; mentionedUserIds: string[]
  createdAt: Date
}) {
  return {
    id:               row.id,
    publicationId:    row.publicationId,
    sectionId:        row.sectionId,
    authorId:         row.authorId,
    authorName:       row.authorName,
    text:             row.text,
    severity:         row.severity,
    status:           row.status,
    resolvedBy:       row.resolvedBy,
    resolvedAt:       row.resolvedAt?.toISOString() ?? null,
    resolutionNote:   row.resolutionNote,
    parentCommentId:  row.parentCommentId,
    mentionedUserIds: row.mentionedUserIds,
    createdAt:        row.createdAt.toISOString(),
  }
}

export const publicationCommentRoutes: FastifyPluginAsync = async (app) => {
  // --- GET /publications/:id/comments (optionally scoped by sectionId) ---
  app.get('/:id/comments', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({ sectionId: z.string().optional() }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.publicationSectionComment.findMany({
      where:   { publicationId: id, ...(q.data.sectionId && { sectionId: q.data.sectionId }) },
      orderBy: { createdAt: 'asc' },
    })
    return { publicationId: id, comments: rows.map(shapeComment) }
  })

  // --- POST /publications/:id/sections/:sectionId/comments ---------------
  app.post('/:id/sections/:sectionId/comments', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, projectId: true, title: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanCommentOnPublication(app.prisma, request.user!, id))) {
      return reply.code(403).send(PUBLICATION_COMMENT_FORBIDDEN)
    }

    // Author name for denormalisation — falls back to the user's email
    // local-part when name is unset.
    const author = await app.prisma.user.findUnique({
      where:  { id: request.user!.id },
      select: { name: true, email: true },
    })
    const authorName = author?.name?.trim() || author?.email?.split('@')[0] || 'unknown'

    // Validate parentCommentId belongs to the same (publication, section)
    // so threads can't jump across sections or publications.
    if (parsed.data.parentCommentId) {
      const parent = await app.prisma.publicationSectionComment.findUnique({
        where:  { id: parsed.data.parentCommentId },
        select: { publicationId: true, sectionId: true },
      })
      if (!parent || parent.publicationId !== id || parent.sectionId !== sectionId) {
        return reply.code(422).send({
          error:   'invalid_parent',
          message: 'parentCommentId does not belong to this publication section.',
        })
      }
    }

    const row = await app.prisma.publicationSectionComment.create({
      data: {
        publicationId:    id,
        sectionId,
        authorId:         request.user!.id,
        authorName,
        text:             parsed.data.text,
        severity:         parsed.data.severity ?? 'info',
        parentCommentId:  parsed.data.parentCommentId ?? null,
        mentionedUserIds: parsed.data.mentionedUserIds ?? [],
      },
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'publication_comment_created',
      entityType: 'publication',
      entityId:   id,
      details:    { sectionId, commentId: row.id, severity: row.severity, textLen: row.text.length, mentionCount: row.mentionedUserIds.length },
      ipAddress:  request.ip ?? null,
    })

    // Fan out @mention notifications. Deliberately best-effort: a
    // notification write failure must never fail the comment create.
    if (row.mentionedUserIds.length > 0 && app.notifications) {
      for (const mentionedId of row.mentionedUserIds) {
        if (mentionedId === request.user!.id) continue  // don't notify self
        await app.notifications.send({
          recipientId: mentionedId,
          kind:        'publication.comment_mention',
          severity:    'info',
          title:       `${authorName} mentioned you in a publication comment`,
          body:        `on "${pub.title}" § ${sectionId} — ${row.text.slice(0, 160)}${row.text.length > 160 ? '…' : ''}`,
          linkPath:    `/projects/${pub.projectId}/scientific-writing/publications/${id}/edit#comment-${row.id}`,
          payload:     { publicationId: id, projectId: pub.projectId, sectionId, commentId: row.id },
        }).catch(err => request.log.warn({ err, mentionedId }, 'publication.comment_mention: notification send failed'))
      }
    }

    return reply.code(201).send(shapeComment(row))
  })

  // --- POST /publications/:id/comments/:commentId/resolve ----------------
  app.post('/:id/comments/:commentId/resolve', { preHandler: writeGate }, async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.publicationSectionComment.findUnique({
      where: { id: commentId },
    })
    if (!row || row.publicationId !== id) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', resolvedAt: row.resolvedAt?.toISOString() })
    }

    // Comment author can always resolve their own; R/A can resolve any.
    const isOwnComment = row.authorId === request.user!.id
    const canModerate  = await actorCanEditPublicationContent(app.prisma, request.user!, id)
    if (!isOwnComment && !canModerate) {
      return reply.code(403).send(PUBLICATION_EDIT_FORBIDDEN)
    }

    const updated = await app.prisma.publicationSectionComment.update({
      where: { id: commentId },
      data: {
        status:         'resolved',
        resolvedBy:     request.user!.id,
        resolvedAt:     new Date(),
        resolutionNote: parsed.data.resolutionNote ?? null,
      },
    })
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'publication_comment_resolved',
      entityType: 'publication',
      entityId:   id,
      details:    { sectionId: row.sectionId, commentId },
      ipAddress:  request.ip ?? null,
    })
    return shapeComment(updated)
  })
}
