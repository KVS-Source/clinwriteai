// Regulatory document comment routes — Phase M-D.5.
//
//   GET    /regulatory-documents/:id/comments                       (list, flat)
//   POST   /regulatory-documents/:id/sections/:sectionId/comments   (create)
//   POST   /regulatory-documents/:id/comments/:commentId/resolve    (resolve)
//
// Role gates mirror M-C.5:
//   - Create: owner / project reviewer / scoped PM / admin
//   - Read:   any authenticated user with Module D access
//   - Resolve: owner / admin / scoped PM, or the original commenter

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  actorCanCommentOnRegulatoryDocument,
  actorCanEditRegulatoryDocument,
  REG_DOC_COMMENT_FORBIDDEN,
  REG_DOC_EDIT_FORBIDDEN,
} from '../access/regulatory-document-raci.js'

const gate      = requireAuth({ modules: ['D'] })
const writeGate = requireAuth({ modules: ['D'] })

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
  id: string; regulatoryDocumentId: string; sectionId: string
  authorId: string; authorName: string
  text: string; severity: string; status: string
  resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
  parentCommentId: string | null; mentionedUserIds: string[]
  createdAt: Date
}) {
  return {
    id:                   row.id,
    regulatoryDocumentId: row.regulatoryDocumentId,
    sectionId:            row.sectionId,
    authorId:             row.authorId,
    authorName:           row.authorName,
    text:                 row.text,
    severity:             row.severity,
    status:               row.status,
    resolvedBy:           row.resolvedBy,
    resolvedAt:           row.resolvedAt?.toISOString() ?? null,
    resolutionNote:       row.resolutionNote,
    parentCommentId:      row.parentCommentId,
    mentionedUserIds:     row.mentionedUserIds,
    createdAt:            row.createdAt.toISOString(),
  }
}

async function resolveAuthorName(
  prisma: { user: { findUnique: (args: { where: { id: string }; select: { name: boolean; email: boolean } }) => Promise<{ name: string | null; email: string | null } | null> } },
  userId: string,
): Promise<string> {
  const row = await prisma.user.findUnique({
    where:  { id: userId },
    select: { name: true, email: true },
  })
  return row?.name?.trim() || row?.email?.split('@')[0] || 'unknown'
}

export const regulatoryDocumentCommentRoutes: FastifyPluginAsync = async (app) => {
  // --- GET /regulatory-documents/:id/comments (optional sectionId) ---
  app.get('/:id/comments', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({ sectionId: z.string().optional() }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.regulatoryDocumentSectionComment.findMany({
      where:   { regulatoryDocumentId: id, ...(q.data.sectionId && { sectionId: q.data.sectionId }) },
      orderBy: { createdAt: 'asc' },
    })
    return { regulatoryDocumentId: id, comments: rows.map(shapeComment) }
  })

  // --- POST /regulatory-documents/:id/sections/:sectionId/comments -------
  app.post('/:id/sections/:sectionId/comments', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, projectId: true, title: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanCommentOnRegulatoryDocument(app.prisma, request.user!, id))) {
      return reply.code(403).send(REG_DOC_COMMENT_FORBIDDEN)
    }

    const authorName = await resolveAuthorName(app.prisma, request.user!.id)

    if (parsed.data.parentCommentId) {
      const parent = await app.prisma.regulatoryDocumentSectionComment.findUnique({
        where:  { id: parsed.data.parentCommentId },
        select: { regulatoryDocumentId: true, sectionId: true },
      })
      if (!parent || parent.regulatoryDocumentId !== id || parent.sectionId !== sectionId) {
        return reply.code(422).send({
          error:   'invalid_parent',
          message: 'parentCommentId does not belong to this document section.',
        })
      }
    }

    const row = await app.prisma.regulatoryDocumentSectionComment.create({
      data: {
        regulatoryDocumentId: id,
        sectionId,
        authorId:             request.user!.id,
        authorName,
        text:                 parsed.data.text,
        severity:             parsed.data.severity ?? 'info',
        parentCommentId:      parsed.data.parentCommentId ?? null,
        mentionedUserIds:     parsed.data.mentionedUserIds ?? [],
      },
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'regulatory_document_comment_created',
      entityType: 'regulatory_document',
      entityId:   id,
      details:    { sectionId, commentId: row.id, severity: row.severity, textLen: row.text.length, mentionCount: row.mentionedUserIds.length },
      ipAddress:  request.ip ?? null,
    })

    if (row.mentionedUserIds.length > 0 && app.notifications) {
      for (const mentionedId of row.mentionedUserIds) {
        if (mentionedId === request.user!.id) continue
        await app.notifications.send({
          recipientId: mentionedId,
          kind:        'regulatory_document.comment_mention',
          severity:    'info',
          title:       `${authorName} mentioned you in a regulatory document comment`,
          body:        `on "${doc.title}" § ${sectionId} — ${row.text.slice(0, 160)}${row.text.length > 160 ? '…' : ''}`,
          linkPath:    `/projects/${doc.projectId}/regulatory-writing/documents/${id}/live-editor#comment-${row.id}`,
          payload:     { regulatoryDocumentId: id, projectId: doc.projectId, sectionId, commentId: row.id },
        }).catch(err => request.log.warn({ err, mentionedId }, 'regulatory_document.comment_mention: notification send failed'))
      }
    }

    return reply.code(201).send(shapeComment(row))
  })

  // --- POST /regulatory-documents/:id/comments/:commentId/resolve ------
  app.post('/:id/comments/:commentId/resolve', { preHandler: writeGate }, async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.regulatoryDocumentSectionComment.findUnique({
      where: { id: commentId },
    })
    if (!row || row.regulatoryDocumentId !== id) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', resolvedAt: row.resolvedAt?.toISOString() })
    }

    const isOwnComment = row.authorId === request.user!.id
    const canModerate  = await actorCanEditRegulatoryDocument(app.prisma, request.user!, id)
    if (!isOwnComment && !canModerate) {
      return reply.code(403).send(REG_DOC_EDIT_FORBIDDEN)
    }

    const updated = await app.prisma.regulatoryDocumentSectionComment.update({
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
      action:     'regulatory_document_comment_resolved',
      entityType: 'regulatory_document',
      entityId:   id,
      details:    { sectionId: row.sectionId, commentId },
      ipAddress:  request.ip ?? null,
    })
    return shapeComment(updated)
  })
}
