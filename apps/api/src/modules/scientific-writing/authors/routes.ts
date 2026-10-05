// Authors + ICMJE routes — Module B (API contract §19).
//
// Model notes:
//   - On publication create (Batch 2), each PublicationAuthor got exactly 4
//     PubIcmjeCriterion rows auto-materialised with met=false. This batch
//     exposes read + toggle endpoints for those rows + the soft-gate
//     acknowledgement endpoint (OQ-B-003).
//   - Debarment check is a stub: it marks every requested author 'clear'
//     and records a DebarmentCheckRun row for the audit trail. Replace the
//     stub with the real FDA/OIG lookup client when procurement lands.
//
// The ICMJE criterion index-to-meaning mapping:
//   0 — Substantial contributions to conception/design or data
//   1 — Drafting / critical revision
//   2 — Final approval of version
//   3 — Agreement to be accountable for all aspects

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const toggleCriterionSchema = z.object({
  criterionIndex: z.number().int().min(0).max(3),
  met: z.boolean(),
})

const acknowledgeSchema = z.object({
  // Legacy MSW handler took a name string; we take nothing extra — the
  // acting user already comes from the session cookie.
}).passthrough()

const debarmentSchema = z.object({
  authorIds: z.array(z.string().min(1)).min(1),
})

const addExternalAuthorSchema = z.object({
  name: z.string().min(1),
  initials: z.string().min(1).max(5),
  role: z.string().min(1),
  raci: z.enum(['R', 'A', 'C', 'I']),
  inviteEmail: z.string().email().optional(),
})

export const authorsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:publicationId/authors', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const authors = await app.prisma.publicationAuthor.findMany({
      where: { publicationId, removedAt: null },
      orderBy: { addedAt: 'asc' },
      include: {
        icmjeCriteria: { orderBy: { criterionIndex: 'asc' } },
        icmjeAcknowledgements: { orderBy: { acknowledgedAt: 'desc' }, take: 1 },
      },
    })

    return authors.map(a => {
      const ack = a.icmjeAcknowledgements[0]
      return {
        ...a,
        icmjeAcknowledged: !!ack,
        icmjeAcknowledgedBy: ack?.acknowledgedBy ?? null,
        icmjeAcknowledgedAt: ack?.acknowledgedAt ?? null,
        icmjeAcknowledgements: undefined,  // collapsed into the three fields above
      }
    })
  })

  // Allow a publication manager to add an external KOL author post-creation.
  app.post('/:publicationId/authors', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = addExternalAuthorSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.$transaction(async (tx) => {
      const author = await tx.publicationAuthor.create({
        data: {
          publicationId,
          userId: null,
          name: parsed.data.name,
          initials: parsed.data.initials,
          role: parsed.data.role,
          raci: parsed.data.raci,
          isExternal: true,
          inviteEmail: parsed.data.inviteEmail ?? null,
          invitedAt: parsed.data.inviteEmail ? new Date() : null,
          addedBy: request.user!.id,
        },
      })
      await tx.pubIcmjeCriterion.createMany({
        data: [0, 1, 2, 3].map(i => ({ authorId: author.id, criterionIndex: i })),
      })
      return author
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'publication_author_added',
      entityType: 'publication',
      entityId: publicationId,
      details: { authorId: created.id, name: created.name, isExternal: true, raci: created.raci },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.patch('/:publicationId/authors/:authorId/icmje', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, authorId } = request.params as { publicationId: string; authorId: string }
    const parsed = toggleCriterionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Verify author belongs to publication (defence against pivot-id attacks).
    const author = await app.prisma.publicationAuthor.findFirst({
      where: { id: authorId, publicationId },
    })
    if (!author) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.pubIcmjeCriterion.update({
      where: {
        authorId_criterionIndex: { authorId, criterionIndex: parsed.data.criterionIndex },
      },
      data: {
        met: parsed.data.met,
        confirmedBy: parsed.data.met ? request.user!.id : null,
        confirmedAt: parsed.data.met ? new Date() : null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'icmje_criterion_toggled',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        authorId,
        authorName: author.name,
        criterionIndex: parsed.data.criterionIndex,
        met: parsed.data.met,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:publicationId/authors/:authorId/icmje/acknowledge', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, authorId } = request.params as { publicationId: string; authorId: string }
    const parsed = acknowledgeSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const author = await app.prisma.publicationAuthor.findFirst({
      where: { id: authorId, publicationId },
      include: { icmjeCriteria: true },
    })
    if (!author) return reply.code(404).send({ error: 'not_found' })

    const missing = author.icmjeCriteria.filter(c => !c.met).map(c => c.criterionIndex).sort()
    if (missing.length === 0) {
      return reply.code(409).send({ error: 'nothing_to_acknowledge', message: 'All ICMJE criteria already met' })
    }

    const ack = await app.prisma.pubIcmjeAcknowledgement.create({
      data: {
        authorId,
        acknowledgedBy: request.user!.id,
        missingCriteria: missing,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'icmje_soft_gate_acknowledged',
      entityType: 'publication',
      entityId: publicationId,
      details: { authorId, authorName: author.name, missingCriteria: missing, acknowledgementId: ack.id },
      ipAddress: request.ip ?? null,
    })

    return {
      icmjeAcknowledged: true,
      icmjeAcknowledgedBy: ack.acknowledgedBy,
      icmjeAcknowledgedAt: ack.acknowledgedAt,
      missingCriteria: ack.missingCriteria,
    }
  })

  // Debarment stub — writes a DebarmentCheckRun row so the audit trail
  // reflects the attempt. Real FDA/OIG lookup lands with procurement.
  app.post('/:publicationId/debarment-check', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = debarmentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const authors = await app.prisma.publicationAuthor.findMany({
      where: { publicationId, id: { in: parsed.data.authorIds } },
    })

    const results = authors.map(a => ({
      authorId: a.id,
      authorName: a.name,
      status: 'clear' as const,       // stub result — real lookup lands later
    }))

    const run = await app.prisma.debarmentCheckRun.create({
      data: {
        publicationId,
        runBy: request.user!.id,
        authorsChecked: results.length,
        matchesFound: 0,
        results: results as unknown as object,
      },
    })

    // Mark each checked author as clear so the UI chip reflects it.
    await app.prisma.publicationAuthor.updateMany({
      where: { id: { in: parsed.data.authorIds } },
      data: { debarmentStatus: 'clear', debarmentCheckedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'debarment_check_run',
      entityType: 'publication',
      entityId: publicationId,
      details: { runId: run.id, authorsChecked: results.length, matchesFound: 0, stub: true },
      ipAddress: request.ip ?? null,
    })

    return { checkedAt: run.runAt, results }
  })

  app.post('/:publicationId/authors/:authorId/remind', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, authorId } = request.params as { publicationId: string; authorId: string }
    const author = await app.prisma.publicationAuthor.findFirst({
      where: { id: authorId, publicationId },
    })
    if (!author) return reply.code(404).send({ error: 'not_found' })

    // Real email send goes here once the Postmark/SES adapter lands; for now
    // the audit event is the record of the reminder.
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'author_reminder_sent',
      entityType: 'publication',
      entityId: publicationId,
      details: { authorId, authorName: author.name, inviteEmail: author.inviteEmail ?? null },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
