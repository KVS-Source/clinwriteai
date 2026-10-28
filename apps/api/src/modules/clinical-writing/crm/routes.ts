// Cross-functional Review Meeting (CRM) routes — Module A (API contract §11).
//
// Fits between submit-for-review and e-signature. Writers submit a doc →
// doc.status='in_review' → chair schedules a CRM → doc.status flips to
// 'crm_in_progress' when the meeting starts → each open comment gets
// resolved in the meeting → when the chair closes the meeting with all
// comments resolved, doc.status → 'pending_signature' and the e-sig
// chain (deferred) takes over.
//
// Document state machine transitions driven here:
//   in_review        → crm_in_progress   (meeting start)
//   crm_in_progress  → pending_signature (meeting complete, all comments resolved)
//   crm_in_progress  → in_authoring      (meeting complete, chair bounces to author
//                                          — handled via existing /transition endpoint)

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import type { PrismaClient } from '@prisma/client'
import { fireAutoComplete } from '../checklist/auto-complete.js'

const scheduleSchema = z.object({
  chairId: z.string().min(1),
  scheduledDate: z.string().datetime(),
  startTime: z.string().min(1),             // '14:00 UTC'
  endTime: z.string().min(1),
  attendees: z.array(z.object({
    userId: z.string(),
    roleInCrm: z.enum(['Chair', 'Author', 'Reviewer', 'Observer']),
  })).default([]),
})

const addAttendeeSchema = z.object({
  userId: z.string().min(1),
  roleInCrm: z.enum(['Chair', 'Author', 'Reviewer', 'Observer']),
})

const resolveSchema = z.object({
  commentId: z.string().min(1),
  resolutionType: z.enum(['accept', 'accept_with_modification', 'reject']),
  resolutionNote: z.string().min(1, 'resolution note required (Part 11 audit)'),
})

// Shape CRM meetings for the UI's packages/types `CRMMeeting` interface.
// Derivations:
//   - documentTitle: resolved from parent Document
//   - version: Document.currentVersion.versionNumber
//   - date: alias of scheduledDate (ISO date → ISO datetime)
//   - chair / attendees: User lookups resolved to TeamMember shape
//   - commentIds: all comment ids on the document
//   - resolvedIds: comment ids resolved in THIS meeting (from CrmResolution)
//   - pendingIds: openComments ∖ resolvedIds (open on doc minus resolved here)
//   - activeId: null — "currently being discussed" state isn't tracked server-side
async function fetchCrmContext(
  prisma: import('@prisma/client').PrismaClient,
  documentId: string,
) {
  const [doc, comments] = await Promise.all([
    prisma.document.findUnique({
      where: { id: documentId },
      select: { title: true, currentVersion: { select: { versionNumber: true } } },
    }),
    prisma.comment.findMany({
      where: { documentId },
      select: { id: true, status: true, verdict: true },
    }),
  ])
  return {
    documentTitle: doc?.title ?? documentId,
    version: doc?.currentVersion?.versionNumber ?? 'v0.0',
    allCommentIds: comments.map(c => c.id),
    // Approval verdicts are sign-offs, not issues — the complete gate skips
    // them, so they are not 'pending' resolution either.
    openCommentIds: new Set(comments.filter(c => c.status === 'open' && c.verdict !== 'approve').map(c => c.id)),
  }
}

function toTeamMember(userId: string, u: { name: string; initials: string | null; role: string } | null, raci: string) {
  return {
    userId,
    name: u?.name ?? userId,
    initials: u?.initials ?? '',
    role: u?.role ?? '',
    raci,
  }
}

async function crmMeetingShape(
  prisma: import('@prisma/client').PrismaClient,
  meeting: {
    id: string; documentId: string; meetingRef: string; chairId: string
    status: string; scheduledDate: Date; startTime: string; endTime: string
    startedAt: Date | null; endedAt: Date | null; createdAt: Date
    attendees: Array<{ userId: string; roleInCrm: string }>
    resolutions: Array<{ commentId: string }>
  },
  ctx: { documentTitle: string; version: string; openCommentIds: Set<string>; allCommentIds: string[] },
) {
  const userIds = Array.from(new Set([meeting.chairId, ...meeting.attendees.map(a => a.userId)]))
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, initials: true, role: true },
  })
  const byId = new Map(users.map(u => [u.id, u]))
  const resolvedIds = meeting.resolutions.map(r => r.commentId)
  const resolvedSet = new Set(resolvedIds)
  const pendingIds = Array.from(ctx.openCommentIds).filter(id => !resolvedSet.has(id))
  return {
    id: meeting.id,
    documentId: meeting.documentId,
    documentTitle: ctx.documentTitle,
    meetingRef: meeting.meetingRef,
    version: ctx.version,
    date: meeting.scheduledDate.toISOString(),
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    startedAt: meeting.startedAt?.toISOString(),
    endedAt: meeting.endedAt?.toISOString(),
    status: meeting.status,             // scheduled | in_progress | complete | cancelled
    chair: toTeamMember(meeting.chairId, byId.get(meeting.chairId) ?? null, 'A'),
    attendees: meeting.attendees.map(a => toTeamMember(a.userId, byId.get(a.userId) ?? null, a.roleInCrm === 'Chair' ? 'A' : a.roleInCrm === 'Author' ? 'R' : 'C')),
    commentIds: ctx.allCommentIds,
    resolvedIds,
    activeId: null as string | null,
    pendingIds,
  }
}

export const crmRoutes: FastifyPluginAsync = async (app) => {
  // --- Meetings -----------------------------------------------------------

  app.get('/documents/:documentId/crm', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const [meetings, ctx] = await Promise.all([
      app.prisma.crmMeeting.findMany({
        where: { documentId },
        orderBy: { scheduledDate: 'asc' },
        include: { attendees: true, resolutions: true },
      }),
      fetchCrmContext(app.prisma, documentId),
    ])
    return Promise.all(meetings.map(m => crmMeetingShape(app.prisma, m, ctx)))
  })

  app.post('/documents/:documentId/crm', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = scheduleSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (doc.status !== 'in_review' && doc.status !== 'crm_in_progress') {
      return reply.code(422).send({
        error: 'wrong_status',
        message: `CRM can only be scheduled when doc is in_review or crm_in_progress (current: ${doc.status})`,
      })
    }

    const meetingRef = await nextCrmRef(app.prisma)

    // Idempotent: if the caller forgot the chair in attendees, make sure
    // it's recorded. The DB UNIQUE(meeting, user) covers the dup case.
    const attendeeSet = new Map<string, string>()
    for (const a of parsed.data.attendees) attendeeSet.set(a.userId, a.roleInCrm)
    attendeeSet.set(parsed.data.chairId, 'Chair')

    const created = await app.prisma.$transaction(async (tx) => {
      const meeting = await tx.crmMeeting.create({
        data: {
          documentId,
          meetingRef,
          chairId: parsed.data.chairId,
          scheduledDate: new Date(parsed.data.scheduledDate),
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
        },
      })
      await tx.crmAttendee.createMany({
        data: Array.from(attendeeSet.entries()).map(([userId, roleInCrm]) => ({
          meetingId: meeting.id,
          userId,
          roleInCrm,
        })),
      })
      return meeting
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'crm_meeting_scheduled',
      entityType: 'document',
      entityId: documentId,
      details: {
        meetingId: created.id,
        meetingRef,
        chairId: parsed.data.chairId,
        attendeeCount: attendeeSet.size,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.post('/crm/:meetingId/attendees', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const parsed = addAttendeeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    if (meeting.status === 'complete' || meeting.status === 'cancelled') {
      return reply.code(409).send({ error: 'meeting_closed', message: `Cannot modify attendees on ${meeting.status} meeting` })
    }

    const created = await app.prisma.crmAttendee.upsert({
      where: { meetingId_userId: { meetingId, userId: parsed.data.userId } },
      create: {
        meetingId,
        userId: parsed.data.userId,
        roleInCrm: parsed.data.roleInCrm,
      },
      update: { roleInCrm: parsed.data.roleInCrm },
    })

    return reply.code(201).send(created)
  })

  // --- Meeting lifecycle --------------------------------------------------

  app.post('/crm/:meetingId/start', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    if (meeting.chairId !== request.user!.id && !['admin'].includes(request.user!.role)) {
      return reply.code(403).send({ error: 'only_chair', message: 'Only the chair (or admin) can start the meeting' })
    }
    if (meeting.status === 'in_progress') return meeting  // idempotent
    if (meeting.status !== 'scheduled') {
      return reply.code(409).send({ error: 'wrong_status', message: `Cannot start a ${meeting.status} meeting` })
    }

    const now = new Date()
    const updated = await app.prisma.$transaction(async (tx) => {
      const m = await tx.crmMeeting.update({
        where: { id: meetingId },
        data: { status: 'in_progress', startedAt: now },
      })
      // Flip the document to crm_in_progress — the state machine permits
      // this from in_review. If the doc is already crm_in_progress (e.g.
      // a second meeting started on the same doc), the transition is a no-op.
      await tx.document.updateMany({
        where: { id: meeting.documentId, status: 'in_review' },
        data: { status: 'crm_in_progress' },
      })
      return m
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'crm_meeting_started',
      entityType: 'document',
      entityId: meeting.documentId,
      details: { meetingId, meetingRef: meeting.meetingRef },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/crm/:meetingId/complete', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({
      where: { id: meetingId },
      include: { resolutions: true },
    })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    if (meeting.chairId !== request.user!.id && !['admin'].includes(request.user!.role)) {
      return reply.code(403).send({ error: 'only_chair' })
    }
    if (meeting.status !== 'in_progress') {
      return reply.code(409).send({ error: 'wrong_status', message: `Cannot complete a ${meeting.status} meeting` })
    }

    // Gate: all OPEN comments on this document must have a resolution in
    // THIS meeting. Resolutions from other meetings don't count (chair
    // explicitly accepted responsibility by scheduling this one).
    // Reviewer "approve" verdicts are sign-offs, not issues — they don't need
    // a resolution (otherwise every section approval blocked the meeting).
    // Plain comments (verdict null) and request_changes / block_approval
    // verdicts still do. The OR keeps null verdicts: `not: 'approve'` alone
    // would drop them in SQL.
    const openComments = await app.prisma.comment.findMany({
      where: {
        documentId: meeting.documentId,
        status: 'open',
        OR: [{ verdict: null }, { verdict: { not: 'approve' } }],
      },
      select: { id: true },
    })
    const resolvedIds = new Set(meeting.resolutions.map(r => r.commentId))
    const unresolved = openComments.filter(c => !resolvedIds.has(c.id))
    if (unresolved.length > 0) {
      return reply.code(422).send({
        error: 'comments_unresolved',
        message: `${unresolved.length} open comment(s) unresolved in this meeting`,
        unresolvedCommentIds: unresolved.map(c => c.id),
      })
    }

    const now = new Date()
    const updated = await app.prisma.$transaction(async (tx) => {
      const m = await tx.crmMeeting.update({
        where: { id: meetingId },
        data: { status: 'complete', endedAt: now },
      })
      // Advance doc to pending_signature. updateMany with the status
      // predicate makes this a no-op if someone else already moved it.
      await tx.document.updateMany({
        where: { id: meeting.documentId, status: 'crm_in_progress' },
        data: { status: 'pending_signature' },
      })
      return m
    })

    // Auto-complete any ChecklistInstanceItem tagged autoCompleteOn=
    // 'crm_complete' — typically "Cross-functional review meeting
    // minutes recorded" (CSR Full) and "Cross-functional review complete"
    // (Protocol). Non-fatal.
    const autoReport = await fireAutoComplete(app.prisma, app.audit, {
      trigger: 'crm_complete',
      documentId: meeting.documentId,
      actorId: request.user!.id,
      ipAddress: request.ip ?? null,
    }).catch(err => {
      app.log.warn({ err, documentId: meeting.documentId }, 'auto_complete crm_complete failed — items left pending')
      return null
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'crm_meeting_completed',
      entityType: 'document',
      entityId: meeting.documentId,
      details: {
        meetingId,
        meetingRef: meeting.meetingRef,
        resolutionCount: meeting.resolutions.length,
        autoCompletedCount: autoReport?.completedCount ?? 0,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/crm/:meetingId/cancel', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    if (meeting.status === 'complete' || meeting.status === 'cancelled') {
      return reply.code(409).send({ error: 'already_closed' })
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      const m = await tx.crmMeeting.update({ where: { id: meetingId }, data: { status: 'cancelled' } })
      // If the doc had been flipped to crm_in_progress for this meeting,
      // and no other active meeting exists, revert back to in_review so
      // the doc isn't stuck.
      const otherActive = await tx.crmMeeting.count({
        where: {
          documentId: meeting.documentId,
          id: { not: meetingId },
          status: { in: ['scheduled', 'in_progress'] },
        },
      })
      if (otherActive === 0) {
        await tx.document.updateMany({
          where: { id: meeting.documentId, status: 'crm_in_progress' },
          data: { status: 'in_review' },
        })
      }
      return m
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'crm_meeting_cancelled',
      entityType: 'document',
      entityId: meeting.documentId,
      details: { meetingId, meetingRef: meeting.meetingRef },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- Resolutions --------------------------------------------------------

  app.post('/crm/:meetingId/resolve', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const parsed = resolveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    if (meeting.status !== 'in_progress') {
      return reply.code(409).send({ error: 'wrong_status', message: `Resolutions only accepted when meeting is in_progress (current: ${meeting.status})` })
    }

    // Verify the comment is on this document.
    const comment = await app.prisma.comment.findUnique({ where: { id: parsed.data.commentId } })
    if (!comment || comment.documentId !== meeting.documentId) {
      return reply.code(404).send({ error: 'comment_not_on_document' })
    }
    if (comment.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved', message: `Comment ${parsed.data.commentId} already resolved` })
    }

    // Create the CRM resolution AND flip the comment to resolved in one tx.
    const resolution = await app.prisma.$transaction(async (tx) => {
      const res = await tx.crmResolution.create({
        data: {
          meetingId,
          commentId: parsed.data.commentId,
          resolutionType: parsed.data.resolutionType,
          resolutionNote: parsed.data.resolutionNote,
          resolvedBy: request.user!.id,
        },
      })
      await tx.comment.update({
        where: { id: parsed.data.commentId },
        data: {
          status: 'resolved',
          resolvedBy: request.user!.id,
          resolvedAt: new Date(),
          resolutionNote: `[CRM:${meeting.meetingRef}:${parsed.data.resolutionType}] ${parsed.data.resolutionNote}`,
        },
      })
      return res
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'crm_resolution_logged',
      entityType: 'document',
      entityId: meeting.documentId,
      details: {
        meetingId,
        meetingRef: meeting.meetingRef,
        commentId: parsed.data.commentId,
        resolutionType: parsed.data.resolutionType,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(resolution)
  })

  app.get('/crm/:meetingId/resolutions', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.crmResolution.findMany({
      where: { meetingId },
      orderBy: { resolvedAt: 'asc' },
    })
  })

  // --- AI Note-Taker (Phase 1) ----------------------------------------------
  // Audio is never stored (DPDPA stance). The chair uploads a pre-transcribed
  // text (Zoom "Save transcript" / Teams export / Otter for now; Recall.ai
  // bot in Phase 3), we extract per-comment draft notes, chair edits them
  // in-line in the resolution composer before saving the CrmResolution.

  const transcriptSchema = z.object({
    rawText: z.string().min(10, 'Transcript is too short to be useful.'),
    source:  z.enum(['manual_paste', 'zoom_native', 'teams_export', 'otter', 'bot']).default('manual_paste'),
  })

  /** POST /crm/:meetingId/transcript — upload a transcript + extract drafts. */
  app.post('/crm/:meetingId/transcript', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const parsed = transcriptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const meeting = await app.prisma.crmMeeting.findUnique({
      where: { id: meetingId },
      include: {
        resolutions: { select: { commentId: true } },
      },
    })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })

    const rawText = parsed.data.rawText.trim()
    const wordCount = rawText.split(/\s+/).filter(Boolean).length

    // Upsert the transcript (one per meeting). Replaces on re-upload.
    const transcript = await app.prisma.crmMeetingTranscript.upsert({
      where:  { meetingId },
      update: { rawText, wordCount, source: parsed.data.source, uploadedBy: request.user!.id, uploadedAt: new Date() },
      create: { meetingId, rawText, wordCount, source: parsed.data.source, uploadedBy: request.user!.id },
    })

    // Pull open comments (not yet resolved in this meeting) so the AI can
    // target each with a per-comment draft note.
    const resolvedIds = new Set(meeting.resolutions.map(r => r.commentId))
    const openComments = await app.prisma.comment.findMany({
      where: {
        documentId: meeting.documentId,
        status:     'open',
      },
      select: { id: true, sectionRef: true, severity: true, text: true, reviewerId: true },
    })
    const targets = openComments
      .filter(c => !resolvedIds.has(c.id))
      .map(c => ({ id: c.id, sectionRef: c.sectionRef, severity: c.severity, body: c.text, authorName: c.reviewerId }))

    let drafts: Array<{ commentId: string; draftText: string }> = []
    let aiModel = 'none'
    let aiCallRecordId: string | null = null

    if (targets.length > 0) {
      // One AI call extracts drafts for every open comment at once — cheaper
      // than N round-trips and gives the model context about which comments
      // were discussed in which order within the transcript.
      const prompt = buildDraftExtractionPrompt(rawText, targets)
      try {
        const result = await app.aiGateway.chat({
          tenantId:        request.user!.tenantId,
          actorId:         request.user!.id,
          module:          'A',
          intent:          'custom',
          model:           'auto',
          prompt,
          maxOutputTokens: Math.min(4096, 128 + targets.length * 180),
          documentId:      meeting.documentId,
          promptText:      `CRM AI Note-Taker: extract ${targets.length} resolution-note drafts`,
        })
        aiModel = result.model
        aiCallRecordId = result.recordId
        drafts = parseDraftExtractionResponse(result.responseText, targets.map(t => t.id))
      } catch (err: unknown) {
        app.log.warn({ err, meetingId }, 'ai_note_taker: draft extraction failed; transcript saved without drafts')
      }
    }

    // Replace any prior drafts for the comments we re-generated. Comments
    // we didn't touch keep their existing drafts.
    for (const d of drafts) {
      await app.prisma.crmAiDraftNote.upsert({
        where:  { meetingId_commentId: { meetingId, commentId: d.commentId } },
        update: { draftText: d.draftText, aiModel, aiCallRecordId, generatedAt: new Date() },
        create: { meetingId, commentId: d.commentId, draftText: d.draftText, aiModel, aiCallRecordId },
      })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId:   request.user!.id,
      action:    'crm_transcript_uploaded',
      entityType:'crm_meeting',
      entityId:  meetingId,
      details:   { source: parsed.data.source, wordCount, draftsGenerated: drafts.length, aiModel },
      ipAddress: request.ip ?? null,
    })

    return {
      transcript: {
        id:         transcript.id,
        meetingId:  transcript.meetingId,
        wordCount:  transcript.wordCount,
        source:     transcript.source,
        uploadedBy: transcript.uploadedBy,
        uploadedAt: transcript.uploadedAt.toISOString(),
      },
      drafts: drafts.length,
      aiModel,
    }
  })

  /** GET /crm/:meetingId/ai-drafts — list current per-comment drafts. */
  app.get('/crm/:meetingId/ai-drafts', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({ where: { id: meetingId }, select: { id: true } })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })

    const [drafts, transcript] = await Promise.all([
      app.prisma.crmAiDraftNote.findMany({
        where:   { meetingId },
        orderBy: { generatedAt: 'desc' },
      }),
      app.prisma.crmMeetingTranscript.findUnique({ where: { meetingId } }),
    ])

    return {
      meetingId,
      drafts: drafts.map(d => ({
        commentId:    d.commentId,
        draftText:    d.draftText,
        aiModel:      d.aiModel,
        generatedAt:  d.generatedAt.toISOString(),
      })),
      transcript: transcript
        ? {
            wordCount:  transcript.wordCount,
            source:     transcript.source,
            uploadedAt: transcript.uploadedAt.toISOString(),
          }
        : null,
    }
  })

  /** POST /crm/:meetingId/minutes — generate minutes HTML from transcript + resolutions. */
  app.post('/crm/:meetingId/minutes', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { meetingId } = request.params as { meetingId: string }
    const meeting = await app.prisma.crmMeeting.findUnique({
      where: { id: meetingId },
      include: {
        attendees:    true,
        resolutions:  { orderBy: { resolvedAt: 'asc' } },
        transcript:   true,
      },
    })
    if (!meeting) return reply.code(404).send({ error: 'not_found' })

    // Pull comments so the minutes can show section + severity + body text.
    const commentIds = meeting.resolutions.map(r => r.commentId)
    const commentRows = commentIds.length === 0 ? [] : await app.prisma.comment.findMany({
      where: { id: { in: commentIds } },
      select: { id: true, sectionRef: true, severity: true, text: true },
    })
    const commentById = new Map(commentRows.map(c => [c.id, { sectionRef: c.sectionRef as string | null, severity: c.severity as string | null, body: c.text }]))

    // Resolve attendee names from User rows.
    const attendeeUserIds = meeting.attendees.map(a => a.userId)
    const users = attendeeUserIds.length === 0 ? [] : await app.prisma.user.findMany({
      where: { id: { in: attendeeUserIds } },
      select: { id: true, name: true, email: true },
    })
    const userById = new Map(users.map(u => [u.id, u]))

    // Try an AI pass to produce a narrative summary paragraph; fall back to
    // the structured-only shell if the AI call fails.
    let aiNarrative = ''
    let aiModel: string | null = null
    if (meeting.transcript) {
      try {
        const result = await app.aiGateway.chat({
          tenantId:        request.user!.tenantId,
          actorId:         request.user!.id,
          module:          'A',
          intent:          'custom',
          model:           'auto',
          prompt:          buildMinutesNarrativePrompt(meeting.transcript.rawText, meeting.resolutions, commentById),
          maxOutputTokens: 1024,
          documentId:      meeting.documentId,
          promptText:      'CRM AI Note-Taker: minutes narrative',
        })
        aiNarrative = result.responseText.trim()
        aiModel = result.model
      } catch (err) {
        app.log.warn({ err, meetingId }, 'ai_note_taker: minutes narrative failed; shipping structured-only minutes')
      }
    }

    const minutesHtml = buildMinutesHtml({
      meeting,
      attendees: meeting.attendees.map(a => ({
        role: a.roleInCrm,
        name: userById.get(a.userId)?.name ?? userById.get(a.userId)?.email ?? a.userId,
      })),
      resolutions: meeting.resolutions.map(r => ({
        ...r,
        comment: commentById.get(r.commentId) ?? null,
      })),
      narrative: aiNarrative,
    })

    const updated = await app.prisma.crmMeeting.update({
      where: { id: meetingId },
      data:  {
        minutesHtml,
        minutesGeneratedAt: new Date(),
        minutesGeneratedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId:   request.user!.id,
      action:    'crm_minutes_generated',
      entityType:'crm_meeting',
      entityId:  meetingId,
      details:   { aiNarrativeUsed: !!aiNarrative, aiModel, resolutionCount: meeting.resolutions.length },
      ipAddress: request.ip ?? null,
    })

    return {
      meetingId,
      minutesHtml,
      generatedAt: updated.minutesGeneratedAt?.toISOString() ?? null,
    }
  })
}

// --- helpers --------------------------------------------------------------

/**
 * Pure helper exported for test coverage. Given the latest meetingRef
 * (or null if no meetings exist yet), return the next ref formatted
 * `CRM-NNN`. Padded to 3 digits for cardinal order up to 999; wraps to
 * 4-digit CRM-1000 at the end so the format never silently loses
 * ordering if a tenant files more than 999 meetings.
 */
export function formatNextCrmRef(latest: string | null): string {
  const n = latest ? Number(latest.replace('CRM-', '')) + 1 : 1
  const padded = n < 1000 ? String(n).padStart(3, '0') : String(n)
  return `CRM-${padded}`
}

async function nextCrmRef(prisma: PrismaClient): Promise<string> {
  // Global sequence across all projects. A race between concurrent
  // schedulers can produce the same number; DB UNIQUE catches it and the
  // caller retries. Rare enough in practice that a loop isn't worth it.
  const rows = await prisma.$queryRawUnsafe<Array<{ meetingRef: string }>>(
    "SELECT \"meetingRef\" FROM crm_meetings WHERE \"meetingRef\" LIKE 'CRM-%' ORDER BY \"meetingRef\" DESC LIMIT 1",
  )
  return formatNextCrmRef(rows[0]?.meetingRef ?? null)
}

// --- AI Note-Taker helpers (Phase 1) --------------------------------------

interface DraftTarget {
  id:         string
  sectionRef: string | null
  severity:   string | null
  body:       string
  authorName: string | null
}

/**
 * Prompt the AI with the transcript + the full list of open comments and
 * ask for a JSON array of per-comment draft notes. One round-trip, not N.
 * The model gets the comment id so it can key the response back to our ids.
 */
export function buildDraftExtractionPrompt(transcript: string, comments: DraftTarget[]): string {
  const commentBlob = comments.map(c => (
    `- id=${c.id} | section=${c.sectionRef ?? '—'} | severity=${c.severity ?? '—'} | from ${c.authorName ?? 'Unknown'}:\n  "${c.body.replace(/\n/g, ' ').slice(0, 400)}"`
  )).join('\n')

  return [
    'You are an AI note-taker for a Clinical Writing Comments Resolution Meeting (CRM).',
    'You will be given (a) the meeting transcript and (b) a list of open reviewer comments that the chair is working through.',
    'For each comment, draft a 1-3 sentence resolution note that captures what the attendees decided and WHY, grounded in what the transcript actually says.',
    'If the transcript does not mention a comment at all, return an empty string for that comment\'s draftText — do NOT invent a decision.',
    'Attribute speakers if the transcript names them ("Chair noted…", "Dr Chen suggested…"). Keep the tone neutral and clinical — no filler.',
    '',
    '## Transcript',
    transcript.slice(0, 20000),                       // keep well under the model's context budget
    '',
    '## Open comments to draft notes for',
    commentBlob,
    '',
    '## Response format',
    'Return ONLY a JSON array (no prose, no fences). Each entry must have exactly two fields:',
    '  {"commentId": "<id>", "draftText": "<1-3 sentence note or empty string>"}',
    'Order the array in the same order as the comments above. One entry per comment.',
  ].join('\n')
}

/**
 * The AI returns a JSON array; strip code fences / stray prose and extract
 * only the entries whose commentId we recognise. Unknown ids are dropped
 * silently (we never trust the model to invent ids).
 */
export function parseDraftExtractionResponse(responseText: string, allowedIds: string[]): Array<{ commentId: string; draftText: string }> {
  // The model sometimes wraps in ```json ... ``` despite being told not to.
  const stripped = responseText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  // Hunt for the first [ ... ] block so leading narrative is ignored.
  const start = stripped.indexOf('[')
  const end   = stripped.lastIndexOf(']')
  if (start < 0 || end < 0 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const allowed = new Set(allowedIds)
  const out: Array<{ commentId: string; draftText: string }> = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as { commentId?: unknown; draftText?: unknown }
    if (typeof r.commentId !== 'string' || typeof r.draftText !== 'string') continue
    if (!allowed.has(r.commentId)) continue
    const text = r.draftText.trim()
    if (text.length === 0) continue
    out.push({ commentId: r.commentId, draftText: text })
  }
  return out
}

/** Narrative paragraph prompt for the minutes PDF. */
export function buildMinutesNarrativePrompt(
  transcript: string,
  resolutions: Array<{ resolutionType: string; resolutionNote: string; commentId: string }>,
  commentById: Map<string, { sectionRef: string | null; severity: string | null; body: string }>,
): string {
  const resolved = resolutions.map(r => {
    const c = commentById.get(r.commentId)
    return `- [${r.resolutionType}] ${c?.sectionRef ?? '—'} (${c?.severity ?? '—'}): ${r.resolutionNote}`
  }).join('\n')

  return [
    'You are drafting the summary paragraph for the official minutes of a Clinical Writing Comments Resolution Meeting (CRM).',
    'Write 3-5 sentences capturing the overall meeting flow, major decisions, and any outstanding themes. Neutral regulatory tone. No bullet points — this is prose.',
    'Ground every sentence in evidence from the transcript or the resolution list below. If a point was not actually discussed, do not mention it.',
    '',
    '## Transcript',
    transcript.slice(0, 20000),
    '',
    '## Resolutions logged',
    resolved || '(none)',
    '',
    'Return only the paragraph, no headers.',
  ].join('\n')
}

interface MinutesPayload {
  meeting: {
    meetingRef: string
    scheduledDate: Date
    startTime: string
    endTime: string
    startedAt: Date | null
    endedAt:   Date | null
    documentId: string
  }
  attendees:   Array<{ role: string; name: string }>
  resolutions: Array<{
    commentId: string
    resolutionType: string
    resolutionNote: string
    resolvedBy: string
    resolvedAt: Date
    comment:    { sectionRef: string | null; severity: string | null; body: string } | null
  }>
  narrative: string
}

/** Render minutes as a self-contained HTML document, ready for download or print. */
export function buildMinutesHtml(p: MinutesPayload): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const bySeverity = { major: [] as typeof p.resolutions, minor: [] as typeof p.resolutions, query: [] as typeof p.resolutions }
  for (const r of p.resolutions) {
    const sev = (r.comment?.severity ?? 'minor').toLowerCase()
    if (sev === 'major')      bySeverity.major.push(r)
    else if (sev === 'query') bySeverity.query.push(r)
    else                      bySeverity.minor.push(r)
  }

  const resolutionBlock = (title: string, rows: typeof p.resolutions): string => {
    if (rows.length === 0) return ''
    return `
      <h3>${esc(title)} (${rows.length})</h3>
      <table>
        <thead><tr><th>Comment</th><th>Section</th><th>Decision</th><th>Note</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.commentId)}</td>
              <td>${esc(r.comment?.sectionRef ?? '—')}</td>
              <td>${esc(r.resolutionType)}</td>
              <td>${esc(r.resolutionNote)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CRM Minutes — ${esc(p.meeting.meetingRef)}</title>
<style>
  body { font: 13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color: #1E293B; max-width: 760px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 20px; margin-bottom: 0.25rem; }
  h2 { font-size: 14px; margin-top: 1.8rem; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; }
  h3 { font-size: 13px; margin-top: 1.2rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.6rem; }
  th, td { border: 1px solid #E2E8F0; padding: 6px 8px; text-align: left; vertical-align: top; font-size: 12px; }
  th { background: #F8FAFC; }
  .meta { color: #64748B; font-size: 12px; }
  .narrative { background: #F8FAFC; border-left: 3px solid #2563EB; padding: 0.8rem 1rem; margin-top: 0.8rem; font-style: italic; }
  footer { margin-top: 2.5rem; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 0.8rem; }
</style>
</head>
<body>
<h1>Comments Resolution Meeting — ${esc(p.meeting.meetingRef)}</h1>
<p class="meta">
  ${esc(p.meeting.scheduledDate.toISOString().slice(0, 10))}
  · ${esc(p.meeting.startTime)}–${esc(p.meeting.endTime)}
  ${p.meeting.startedAt ? ` · started ${esc(new Date(p.meeting.startedAt).toISOString())}` : ''}
  ${p.meeting.endedAt   ? ` · ended ${esc(new Date(p.meeting.endedAt).toISOString())}`     : ''}
</p>

<h2>Attendees</h2>
<ul>
  ${p.attendees.map(a => `<li>${esc(a.name)} — ${esc(a.role)}</li>`).join('') || '<li>(none recorded)</li>'}
</ul>

${p.narrative ? `<h2>Summary</h2><div class="narrative">${esc(p.narrative)}</div>` : ''}

<h2>Resolutions by severity</h2>
${resolutionBlock('Major', bySeverity.major)}
${resolutionBlock('Minor', bySeverity.minor)}
${resolutionBlock('Query', bySeverity.query)}
${p.resolutions.length === 0 ? '<p><em>No resolutions logged.</em></p>' : ''}

<footer>
  Generated by ClinWrite AI Note-Taker. These minutes are hash-chained via the Audit Trail (action: <code>crm_minutes_generated</code>). The source transcript is retained for the meeting's lifecycle; audio was never stored.
</footer>
</body>
</html>`
}
