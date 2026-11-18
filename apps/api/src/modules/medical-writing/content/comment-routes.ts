// Med content comment routes — Phase M-C.5.
//
// Two surfaces, same shape:
//   /med-content/:id/comments                                (list, flat)
//   /med-content/:id/sections/:sectionId/comments            (create)
//   /med-content/:id/comments/:commentId/resolve             (resolve)
//
//   /med-slides/:slideId/comments                            (list + create)
//   /med-slide-decks/:deckJobId/comments                     (list all for deck)
//   /med-slide-comments/:commentId/resolve                   (resolve)
//
// Role gates mirror M-B.5:
//   - Create: owner / MLR reviewer / scoped PM / admin
//   - Read:   any authenticated user with Module C access
//   - Resolve: owner / admin / scoped PM, or the original commenter

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  actorCanCommentOnMedContent,
  actorCanEditMedContent,
  actorCanCommentOnMedSlide,
  MED_CONTENT_COMMENT_FORBIDDEN,
  MED_CONTENT_EDIT_FORBIDDEN,
} from '../access/med-content-raci.js'

const gate      = requireAuth({ modules: ['C'] })
const writeGate = requireAuth({ modules: ['C'] })

const createSchema = z.object({
  text:             z.string().trim().min(1).max(5000),
  severity:         z.enum(['info', 'warning', 'blocking']).optional(),
  parentCommentId:  z.string().optional(),
  mentionedUserIds: z.array(z.string().min(1)).max(20).optional(),
})

const resolveSchema = z.object({
  resolutionNote: z.string().max(2000).optional(),
})

function shapeSectionComment(row: {
  id: string; contentItemId: string; sectionId: string
  authorId: string; authorName: string
  text: string; severity: string; status: string
  resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
  parentCommentId: string | null; mentionedUserIds: string[]
  createdAt: Date
}) {
  return {
    id:               row.id,
    contentItemId:    row.contentItemId,
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

function shapeSlideComment(row: {
  id: string; slideId: string; deckJobId: string
  authorId: string; authorName: string
  text: string; severity: string; status: string
  resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
  parentCommentId: string | null; mentionedUserIds: string[]
  createdAt: Date
}) {
  return {
    id:               row.id,
    slideId:          row.slideId,
    deckJobId:        row.deckJobId,
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

async function resolveAuthorName(prisma: { user: { findUnique: (args: { where: { id: string }; select: { name: boolean; email: boolean } }) => Promise<{ name: string | null; email: string | null } | null> } }, userId: string): Promise<string> {
  const row = await prisma.user.findUnique({
    where:  { id: userId },
    select: { name: true, email: true },
  })
  return row?.name?.trim() || row?.email?.split('@')[0] || 'unknown'
}

export const medContentCommentRoutes: FastifyPluginAsync = async (app) => {
  // --- GET /med-content/:id/comments (optionally scoped by sectionId) ---
  app.get('/:id/comments', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = z.object({ sectionId: z.string().optional() }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.medContentSectionComment.findMany({
      where:   { contentItemId: id, ...(q.data.sectionId && { sectionId: q.data.sectionId }) },
      orderBy: { createdAt: 'asc' },
    })
    return { contentItemId: id, comments: rows.map(shapeSectionComment) }
  })

  // --- POST /med-content/:id/sections/:sectionId/comments ----------------
  app.post('/:id/sections/:sectionId/comments', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, projectId: true, title: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanCommentOnMedContent(app.prisma, request.user!, id))) {
      return reply.code(403).send(MED_CONTENT_COMMENT_FORBIDDEN)
    }

    const authorName = await resolveAuthorName(app.prisma, request.user!.id)

    if (parsed.data.parentCommentId) {
      const parent = await app.prisma.medContentSectionComment.findUnique({
        where:  { id: parsed.data.parentCommentId },
        select: { contentItemId: true, sectionId: true },
      })
      if (!parent || parent.contentItemId !== id || parent.sectionId !== sectionId) {
        return reply.code(422).send({
          error:   'invalid_parent',
          message: 'parentCommentId does not belong to this content section.',
        })
      }
    }

    const row = await app.prisma.medContentSectionComment.create({
      data: {
        contentItemId:    id,
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
      action:     'med_content_comment_created',
      entityType: 'med_content_item',
      entityId:   id,
      details:    { sectionId, commentId: row.id, severity: row.severity, textLen: row.text.length, mentionCount: row.mentionedUserIds.length },
      ipAddress:  request.ip ?? null,
    })

    if (row.mentionedUserIds.length > 0 && app.notifications) {
      for (const mentionedId of row.mentionedUserIds) {
        if (mentionedId === request.user!.id) continue
        await app.notifications.send({
          recipientId: mentionedId,
          kind:        'med_content.comment_mention',
          severity:    'info',
          title:       `${authorName} mentioned you in a medical content comment`,
          body:        `on "${item.title}" § ${sectionId} — ${row.text.slice(0, 160)}${row.text.length > 160 ? '…' : ''}`,
          linkPath:    `/projects/${item.projectId}/medical-writing/content/${id}/live-editor#comment-${row.id}`,
          payload:     { contentItemId: id, projectId: item.projectId, sectionId, commentId: row.id },
        }).catch(err => request.log.warn({ err, mentionedId }, 'med_content.comment_mention: notification send failed'))
      }
    }

    return reply.code(201).send(shapeSectionComment(row))
  })

  // --- POST /med-content/:id/comments/:commentId/resolve -----------------
  app.post('/:id/comments/:commentId/resolve', { preHandler: writeGate }, async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.medContentSectionComment.findUnique({
      where: { id: commentId },
    })
    if (!row || row.contentItemId !== id) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', resolvedAt: row.resolvedAt?.toISOString() })
    }

    const isOwnComment = row.authorId === request.user!.id
    const canModerate  = await actorCanEditMedContent(app.prisma, request.user!, id)
    if (!isOwnComment && !canModerate) {
      return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    }

    const updated = await app.prisma.medContentSectionComment.update({
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
      action:     'med_content_comment_resolved',
      entityType: 'med_content_item',
      entityId:   id,
      details:    { sectionId: row.sectionId, commentId },
      ipAddress:  request.ip ?? null,
    })
    return shapeSectionComment(updated)
  })
}

// --- Slide-scoped comment routes -----------------------------------------
//
// Mounted without a prefix so the paths are /med-slides/... +
// /med-slide-decks/... (matching slide lock routes).

export const medSlideCommentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/med-slide-decks/:deckJobId/comments', { preHandler: gate }, async (request, reply) => {
    const { deckJobId } = request.params as { deckJobId: string }
    const deck = await app.prisma.medSlideDeckJob.findUnique({
      where: { id: deckJobId }, select: { id: true },
    })
    if (!deck) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.medSlideComment.findMany({
      where:   { deckJobId },
      orderBy: { createdAt: 'asc' },
    })
    return { deckJobId, comments: rows.map(shapeSlideComment) }
  })

  app.get('/med-slides/:slideId/comments', { preHandler: gate }, async (request, reply) => {
    const { slideId } = request.params as { slideId: string }
    const slide = await app.prisma.medSlide.findUnique({
      where: { id: slideId }, select: { id: true },
    })
    if (!slide) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.medSlideComment.findMany({
      where:   { slideId },
      orderBy: { createdAt: 'asc' },
    })
    return { slideId, comments: rows.map(shapeSlideComment) }
  })

  app.post('/med-slides/:slideId/comments', { preHandler: writeGate }, async (request, reply) => {
    const { slideId } = request.params as { slideId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const gateResult = await actorCanCommentOnMedSlide(app.prisma, request.user!, slideId)
    if (!gateResult.allowed || !gateResult.deckJobId || !gateResult.contentItemId) {
      if (!gateResult.deckJobId) return reply.code(404).send({ error: 'not_found' })
      return reply.code(403).send(MED_CONTENT_COMMENT_FORBIDDEN)
    }

    const slide = await app.prisma.medSlide.findUnique({
      where:  { id: slideId },
      select: { id: true, position: true, title: true },
    })
    if (!slide) return reply.code(404).send({ error: 'not_found' })

    const authorName = await resolveAuthorName(app.prisma, request.user!.id)

    if (parsed.data.parentCommentId) {
      const parent = await app.prisma.medSlideComment.findUnique({
        where:  { id: parsed.data.parentCommentId },
        select: { slideId: true },
      })
      if (!parent || parent.slideId !== slideId) {
        return reply.code(422).send({
          error:   'invalid_parent',
          message: 'parentCommentId does not belong to this slide.',
        })
      }
    }

    const row = await app.prisma.medSlideComment.create({
      data: {
        slideId,
        deckJobId:        gateResult.deckJobId,
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
      action:     'med_slide_comment_created',
      entityType: 'med_slide',
      entityId:   slideId,
      details:    { slidePosition: slide.position, commentId: row.id, severity: row.severity, textLen: row.text.length, mentionCount: row.mentionedUserIds.length },
      ipAddress:  request.ip ?? null,
    })

    if (row.mentionedUserIds.length > 0 && app.notifications) {
      const item = await app.prisma.medContentItem.findUnique({
        where:  { id: gateResult.contentItemId },
        select: { title: true, projectId: true },
      })
      for (const mentionedId of row.mentionedUserIds) {
        if (mentionedId === request.user!.id) continue
        await app.notifications.send({
          recipientId: mentionedId,
          kind:        'med_slide.comment_mention',
          severity:    'info',
          title:       `${authorName} mentioned you in a slide comment`,
          body:        `on "${item?.title ?? 'slide deck'}" · slide ${slide.position} — ${row.text.slice(0, 160)}${row.text.length > 160 ? '…' : ''}`,
          linkPath:    item ? `/projects/${item.projectId}/medical-writing/content/${gateResult.contentItemId}/editor#slide-${slide.position}` : undefined,
          payload:     { contentItemId: gateResult.contentItemId, slideId, commentId: row.id },
        }).catch(err => request.log.warn({ err, mentionedId }, 'med_slide.comment_mention: notification send failed'))
      }
    }

    return reply.code(201).send(shapeSlideComment(row))
  })

  app.post('/med-slide-comments/:commentId/resolve', { preHandler: writeGate }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    const parsed = resolveSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.medSlideComment.findUnique({ where: { id: commentId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', resolvedAt: row.resolvedAt?.toISOString() })
    }

    const gateResult = await actorCanCommentOnMedSlide(app.prisma, request.user!, row.slideId)
    const isOwnComment = row.authorId === request.user!.id
    const canModerate  = gateResult.contentItemId
      ? await actorCanEditMedContent(app.prisma, request.user!, gateResult.contentItemId)
      : false
    if (!isOwnComment && !canModerate) {
      return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    }

    const updated = await app.prisma.medSlideComment.update({
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
      action:     'med_slide_comment_resolved',
      entityType: 'med_slide',
      entityId:   row.slideId,
      details:    { commentId },
      ipAddress:  request.ip ?? null,
    })
    return shapeSlideComment(updated)
  })
}
