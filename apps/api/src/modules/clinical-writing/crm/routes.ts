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
      select: { id: true, status: true },
    }),
  ])
  return {
    documentTitle: doc?.title ?? documentId,
    version: doc?.currentVersion?.versionNumber ?? 'v0.0',
    allCommentIds: comments.map(c => c.id),
    openCommentIds: new Set(comments.filter(c => c.status === 'open').map(c => c.id)),
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
    if (meeting.chairId !== request.user!.id && !['admin', 'super-admin'].includes(request.user!.role)) {
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
    if (meeting.chairId !== request.user!.id && !['admin', 'super-admin'].includes(request.user!.role)) {
      return reply.code(403).send({ error: 'only_chair' })
    }
    if (meeting.status !== 'in_progress') {
      return reply.code(409).send({ error: 'wrong_status', message: `Cannot complete a ${meeting.status} meeting` })
    }

    // Gate: all OPEN comments on this document must have a resolution in
    // THIS meeting. Resolutions from other meetings don't count (chair
    // explicitly accepted responsibility by scheduling this one).
    const openComments = await app.prisma.comment.findMany({
      where: { documentId: meeting.documentId, status: 'open' },
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
