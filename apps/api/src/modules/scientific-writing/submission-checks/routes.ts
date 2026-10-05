// Submission readiness check routes — Module B (API contract §20).
//
// SubmissionCheck table shipped in Phase 3B Batch 1; these routes wire the
// workflow:
//   GET    /publications/:id/submission-checks          — list all
//   POST   /publications/:id/submission-checks/run      — bulk re-run (stub)
//   PATCH  /publications/:id/submission-checks/:checkId/acknowledge
//          — transition warn → ack (soft gate; counts as passing)
//   PATCH  /publications/:id/submission-checks/:checkId/resolve
//          — transition block → pass (hard gate; author fixed it)
//
// Gate semantics (data model §21.1):
//   - A publication cannot advance to 'published' while any
//     SubmissionCheck.state='block' remains. Already enforced in
//     publications/routes.ts advance-stage handler.
//   - 'warn' is advisory; the UI shows a yellow pill but doesn't block.
//     Acknowledging flips it to 'ack' which travels in the final output
//     package as evidence that the issue was reviewed.
//
// The "run" endpoint is a stub for Phase 3B — the real check engine lives
// across multiple files (format checker, word counter, EQUATOR validator,
// figure resolution, plagiarism, references). Shipping the full engine is
// a separate session; this scaffold lets the UI exercise the state machine
// end-to-end.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

// Default check set — seeded on first run per publication. Matches the
// data model's 6 groups per §21.1.
const DEFAULT_CHECKS: ReadonlyArray<{ groupId: string; label: string; state: 'pass' | 'warn' | 'block' }> = [
  { groupId: 'format', label: 'Journal template applied', state: 'pass' },
  { groupId: 'format', label: 'Page count within limit', state: 'pass' },
  { groupId: 'words', label: 'Abstract word count ≤ 300', state: 'pass' },
  { groupId: 'words', label: 'Body word count ≤ journal limit', state: 'warn' },
  { groupId: 'equator', label: 'CONSORT checklist complete', state: 'warn' },
  { groupId: 'figures', label: 'Figures ≥ 300 dpi', state: 'pass' },
  { groupId: 'figures', label: 'Figure legends present', state: 'pass' },
  { groupId: 'statements', label: 'Funding statement present', state: 'pass' },
  { groupId: 'statements', label: 'Conflict of interest statement', state: 'warn' },
  { groupId: 'statements', label: 'Author contributions', state: 'pass' },
  { groupId: 'statements', label: 'Data availability statement', state: 'pass' },
  { groupId: 'statements', label: 'Clinical trial registration', state: 'pass' },
  { groupId: 'plagiarism', label: 'Plagiarism check completed', state: 'warn' },
  { groupId: 'refs', label: 'All citations have DOIs', state: 'pass' },
  { groupId: 'refs', label: 'Vancouver formatting', state: 'pass' },
]

const ackSchema = z.object({
  note: z.string().optional(),
})

const resolveSchema = z.object({
  note: z.string().min(1, 'resolution note is required for Part 11 audit trail'),
})

export const submissionChecksRoutes: FastifyPluginAsync = async (app) => {
  // Materialise the default check set lazily on first GET so the UI has
  // something to render without an explicit "seed" admin action.
  async function ensureSeeded(publicationId: string): Promise<void> {
    const count = await app.prisma.submissionCheck.count({ where: { publicationId } })
    if (count > 0) return
    await app.prisma.submissionCheck.createMany({
      data: DEFAULT_CHECKS.map(c => ({
        publicationId,
        groupId: c.groupId,
        label: c.label,
        state: c.state,
        note: '',
      })),
    })
  }

  app.get('/:publicationId/submission-checks', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    await ensureSeeded(publicationId)
    return app.prisma.submissionCheck.findMany({
      where: { publicationId },
      orderBy: [{ groupId: 'asc' }, { label: 'asc' }],
    })
  })

  // Re-run all checks. Real check engine lands separately; this stub
  // bumps lastRunAt + preserves current states (so a user who just
  // acknowledged something doesn't see it re-flip).
  app.post('/:publicationId/submission-checks/run', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    await ensureSeeded(publicationId)
    const now = new Date()
    await app.prisma.submissionCheck.updateMany({
      where: { publicationId },
      data: { lastRunAt: now },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'submission_checks_run',
      entityType: 'publication',
      entityId: publicationId,
      details: { runAt: now.toISOString(), stub: true },
      ipAddress: request.ip ?? null,
    })

    return app.prisma.submissionCheck.findMany({
      where: { publicationId },
      orderBy: [{ groupId: 'asc' }, { label: 'asc' }],
    })
  })

  // Acknowledge a 'warn' check. Advisory → ack transition. Soft gate.
  app.patch('/:publicationId/submission-checks/:checkId/acknowledge', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, checkId } = request.params as { publicationId: string; checkId: string }
    const parsed = ackSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.submissionCheck.findFirst({ where: { id: checkId, publicationId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })

    // Only 'warn' checks can be acknowledged. 'block' needs a real fix
    // (resolve endpoint); 'pass'/'ack' are already fine.
    if (row.state !== 'warn') {
      return reply.code(409).send({
        error: 'not_ackable',
        message: `Only 'warn' checks can be acknowledged (current: ${row.state})`,
      })
    }

    const updated = await app.prisma.submissionCheck.update({
      where: { id: checkId },
      data: {
        state: 'ack',
        resolvedBy: request.user!.id,
        resolvedAt: new Date(),
        ...(parsed.data.note && { note: parsed.data.note }),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'submission_check_acknowledged',
      entityType: 'publication',
      entityId: publicationId,
      details: { checkId, groupId: row.groupId, label: row.label, note: parsed.data.note ?? null },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Resolve a 'block' check. Hard gate — a resolution means the author
  // actually fixed the underlying content (not just acknowledged it).
  // Resolution note is REQUIRED (Part 11 audit evidence).
  app.patch('/:publicationId/submission-checks/:checkId/resolve', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, checkId } = request.params as { publicationId: string; checkId: string }
    const parsed = resolveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.submissionCheck.findFirst({ where: { id: checkId, publicationId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })

    if (row.state !== 'block') {
      return reply.code(409).send({
        error: 'not_resolvable',
        message: `Only 'block' checks need to be resolved (current: ${row.state})`,
      })
    }

    const updated = await app.prisma.submissionCheck.update({
      where: { id: checkId },
      data: {
        state: 'pass',
        resolvedBy: request.user!.id,
        resolvedAt: new Date(),
        note: parsed.data.note,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'submission_check_resolved',
      entityType: 'publication',
      entityId: publicationId,
      details: { checkId, groupId: row.groupId, label: row.label, resolutionNote: parsed.data.note },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
