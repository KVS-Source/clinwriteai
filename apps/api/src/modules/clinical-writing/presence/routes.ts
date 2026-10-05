// Module A §10 — section-level presence (REST layer).
//
// Clients poll POST /documents/:id/presence on section focus, PATCH
// /heartbeat every 30-45s, DELETE on blur. The reaper worker closes
// sessions with no heartbeat for PRESENCE_STALE_SECONDS so a dead tab
// doesn't ghost in the "who's here" list indefinitely.
//
// Socket.io push for live avatars is a follow-up — Phase 3A deferral.
// The shape returned by GET /presence is designed to feed either a
// polling or push UI unchanged.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const PRESENCE_STALE_SECONDS = 90

const joinSchema = z.object({
  sectionId: z.string().min(1),                                    // '§11.4.1'
  status: z.enum(['active', 'idle']).default('active'),
})

const heartbeatSchema = z.object({
  status: z.enum(['active', 'idle']).optional(),
  sectionId: z.string().min(1).optional(),                         // user moved to a new section
})

export const presenceRoutes: FastifyPluginAsync = async (app) => {
  // --- Join (create or refresh) ------------------------------------------

  app.post('/:documentId/presence', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = joinSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    // Close any prior active sessions this user has on this document — a
    // user moving between sections should flip to a single new row rather
    // than accrue a trail. Multi-tab is still possible across different
    // userIds (shared browser, impersonation); same-user duplicates get
    // pruned at join time.
    await app.prisma.presenceSession.updateMany({
      where: { documentId, userId: request.user!.id, endedAt: null },
      data: { endedAt: new Date(), status: 'ended' },
    })

    const now = new Date()
    const session = await app.prisma.presenceSession.create({
      data: {
        documentId,
        userId: request.user!.id,
        sectionId: parsed.data.sectionId,
        status: parsed.data.status,
        startedAt: now,
        heartbeatAt: now,
      },
    })
    return reply.code(201).send(session)
  })

  // --- Heartbeat (bump + optional section/status change) ------------------

  app.patch('/:documentId/presence/:sessionId/heartbeat', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sessionId } = request.params as { documentId: string; sessionId: string }
    const parsed = heartbeatSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const session = await app.prisma.presenceSession.findUnique({ where: { id: sessionId } })
    if (!session) return reply.code(404).send({ error: 'not_found' })
    if (session.documentId !== documentId) return reply.code(400).send({ error: 'document_mismatch' })
    if (session.userId !== request.user!.id) return reply.code(403).send({ error: 'not_your_session' })
    if (session.endedAt) return reply.code(409).send({ error: 'session_ended' })

    const updated = await app.prisma.presenceSession.update({
      where: { id: sessionId },
      data: {
        heartbeatAt: new Date(),
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.sectionId && { sectionId: parsed.data.sectionId }),
      },
    })
    return updated
  })

  // --- Leave (soft close) -------------------------------------------------

  app.delete('/:documentId/presence/:sessionId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sessionId } = request.params as { documentId: string; sessionId: string }
    const session = await app.prisma.presenceSession.findUnique({ where: { id: sessionId } })
    if (!session) return reply.code(404).send({ error: 'not_found' })
    if (session.documentId !== documentId) return reply.code(400).send({ error: 'document_mismatch' })
    if (session.userId !== request.user!.id && !['admin', 'super-admin'].includes(request.user!.role)) {
      return reply.code(403).send({ error: 'not_your_session' })
    }
    if (session.endedAt) return session  // idempotent

    return app.prisma.presenceSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), status: 'ended' },
    })
  })

  // --- Snapshot (who's here now) ------------------------------------------

  app.get('/:documentId/presence', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    // "Fresh" = heartbeat within the stale window AND not explicitly ended.
    // Stale rows that haven't been reaped yet are excluded here too, so the
    // UI never shows a ghost even if the reaper lags.
    const freshCutoff = new Date(Date.now() - PRESENCE_STALE_SECONDS * 1000)
    const sessions = await app.prisma.presenceSession.findMany({
      where: {
        documentId,
        endedAt: null,
        heartbeatAt: { gte: freshCutoff },
      },
      orderBy: { heartbeatAt: 'desc' },
    })

    // Group by sectionId for the UI; de-dupe by userId within a section
    // (take the freshest row per user, since the reaper may lag).
    const bySection = new Map<string, Map<string, typeof sessions[number]>>()
    for (const s of sessions) {
      const inSection = bySection.get(s.sectionId) ?? new Map()
      const existing = inSection.get(s.userId)
      if (!existing || s.heartbeatAt > existing.heartbeatAt) inSection.set(s.userId, s)
      bySection.set(s.sectionId, inSection)
    }

    return {
      documentId,
      staleSeconds: PRESENCE_STALE_SECONDS,
      sections: Array.from(bySection.entries()).map(([sectionId, users]) => ({
        sectionId,
        users: Array.from(users.values()).map(s => ({
          sessionId: s.id,
          userId: s.userId,
          status: s.status,
          startedAt: s.startedAt,
          heartbeatAt: s.heartbeatAt,
        })),
      })),
      generatedAt: new Date().toISOString(),
    }
  })
}
