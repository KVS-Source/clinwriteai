// Ideation artefact comment routes — Phase M-E.5.
//
//   GET    /ideation-artefacts/:id/comments                       (list, flat)
//   POST   /ideation-artefacts/:id/sections/:sectionId/comments   (create)
//   POST   /ideation-artefacts/:id/comments/:commentId/resolve    (resolve)

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  actorCanCommentOnIdeationArtefact,
  actorCanEditIdeationArtefact,
  IDEATION_ARTEFACT_COMMENT_FORBIDDEN,
  IDEATION_ARTEFACT_EDIT_FORBIDDEN,
} from '../access/ideation-artefact-raci.js'

const gate      = requireAuth({ modules: ['E'] })
const writeGate = requireAuth({ modules: ['E'] })

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
  id: string; ideationArtefactId: string; sectionId: string
  authorId: string; authorName: string
  text: string; severity: string; status: string
  resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
  parentCommentId: string | null; mentionedUserIds: string[]
  createdAt: Date
}) {
  return {
    id:                 row.id,
    ideationArtefactId: row.ideationArtefactId,
    sectionId:          row.sectionId,
    authorId:           row.authorId,
    authorName:         row.authorName,
    text:               row.text,
    severity:           row.severity,
    status:             row.status,
    resolvedBy:         row.resolvedBy,
    resolvedAt:         row.resolvedAt?.toISOString() ?? null,
    resolutionNote:     row.resolutionNote,
    parentCommentId:    row.parentCommentId,
    mentionedUserIds:   row.mentionedUserIds,
    createdAt:          row.createdAt.toISOString(),
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

export const ideationArtefactCommentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/comments', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({ sectionId: z.string().optional() }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.ideationArtefactSectionComment.findMany({
      where:   { ideationArtefactId: id, ...(q.data.sectionId && { sectionId: q.data.sectionId }) },
      orderBy: { createdAt: 'asc' },
    })
    return { ideationArtefactId: id, comments: rows.map(shapeComment) }
  })

  app.post('/:id/sections/:sectionId/comments', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const art = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true, ideationProjectId: true, title: true },
    })
    if (!art) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanCommentOnIdeationArtefact(app.prisma, request.user!, id))) {
      return reply.code(403).send(IDEATION_ARTEFACT_COMMENT_FORBIDDEN)
    }

    const authorName = await resolveAuthorName(app.prisma, request.user!.id)

    if (parsed.data.parentCommentId) {
      const parent = await app.prisma.ideationArtefactSectionComment.findUnique({
        where:  { id: parsed.data.parentCommentId },
        select: { ideationArtefactId: true, sectionId: true },
      })
      if (!parent || parent.ideationArtefactId !== id || parent.sectionId !== sectionId) {
        return reply.code(422).send({
          error:   'invalid_parent',
          message: 'parentCommentId does not belong to this artefact section.',
        })
      }
    }

    const row = await app.prisma.ideationArtefactSectionComment.create({
      data: {
        ideationArtefactId: id,
        sectionId,
        authorId:           request.user!.id,
        authorName,
        text:               parsed.data.text,
        severity:           parsed.data.severity ?? 'info',
        parentCommentId:    parsed.data.parentCommentId ?? null,
        mentionedUserIds:   parsed.data.mentionedUserIds ?? [],
      },
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'ideation_artefact_comment_created',
      entityType: 'ideation_artefact',
      entityId:   id,
      details:    { sectionId, commentId: row.id, severity: row.severity, textLen: row.text.length, mentionCount: row.mentionedUserIds.length },
      ipAddress:  request.ip ?? null,
    })

    if (row.mentionedUserIds.length > 0 && app.notifications) {
      const parent = await app.prisma.ideationProject.findUnique({
        where: { id: art.ideationProjectId }, select: { projectId: true },
      })
      for (const mentionedId of row.mentionedUserIds) {
        if (mentionedId === request.user!.id) continue
        await app.notifications.send({
          recipientId: mentionedId,
          kind:        'ideation_artefact.comment_mention',
          severity:    'info',
          title:       `${authorName} mentioned you in an ideation artefact comment`,
          body:        `on "${art.title}" § ${sectionId} — ${row.text.slice(0, 160)}${row.text.length > 160 ? '…' : ''}`,
          linkPath:    parent ? `/projects/${parent.projectId}/ideation-publishing/projects/${art.ideationProjectId}/artefacts/${id}/live-editor#comment-${row.id}` : undefined,
          payload:     { ideationArtefactId: id, sectionId, commentId: row.id },
        }).catch(err => request.log.warn({ err, mentionedId }, 'ideation_artefact.comment_mention: notification send failed'))
      }
    }

    return reply.code(201).send(shapeComment(row))
  })

  app.post('/:id/comments/:commentId/resolve', { preHandler: writeGate }, async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.ideationArtefactSectionComment.findUnique({
      where: { id: commentId },
    })
    if (!row || row.ideationArtefactId !== id) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', resolvedAt: row.resolvedAt?.toISOString() })
    }

    const isOwnComment = row.authorId === request.user!.id
    const canModerate  = await actorCanEditIdeationArtefact(app.prisma, request.user!, id)
    if (!isOwnComment && !canModerate) {
      return reply.code(403).send(IDEATION_ARTEFACT_EDIT_FORBIDDEN)
    }

    const updated = await app.prisma.ideationArtefactSectionComment.update({
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
      action:     'ideation_artefact_comment_resolved',
      entityType: 'ideation_artefact',
      entityId:   id,
      details:    { sectionId: row.sectionId, commentId },
      ipAddress:  request.ip ?? null,
    })
    return shapeComment(updated)
  })
}
