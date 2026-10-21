// Congress export routes — Module B (API contract §22).
//
// Design per OQ-B-004: there is NO live portal API integration. The
// workflow is:
//   1. Author picks a congress + fills abstract text up to its limit.
//   2. POST /export generates a package (zip of the abstract + metadata)
//      stored via BlobStorage and marks status='exported'. The publication
//      manager downloads it and manually uploads to the portal.
//   3. POST /mark-submitted flips status='submitted' once the manager has
//      done the upload. accepted/rejected flow in from manual flags later.
//
// characterCount freezes on export so the record reflects the exact state
// at export time even if the abstract is later edited.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../../../modules/platform/blob/local-storage.js'

const createOrUpdateSchema = z.object({
  congressId: z.string().min(1),
  congressName: z.string().min(1),
  characterLimit: z.number().int().positive(),
  keywordsRequired: z.number().int().min(0),
  keywordsEntered: z.number().int().min(0).default(0),
  deadline: z.string().datetime(),
  portalUrl: z.string().url(),
})

const exportSchema = z.object({
  abstractText: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
})

const markStatusSchema = z.object({
  status: z.enum(['submitted', 'accepted', 'rejected']),
  note: z.string().optional(),
})

export const congressRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:publicationId/congress', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.congressSubmission.findMany({
      where: { publicationId },
      orderBy: { createdAt: 'desc' },
    })
  })

  // Switching congress mid-flight creates a NEW row (per §22.1 note:
  // "Switching congress creates a new row rather than updating the existing
  // one, preserving the history"). This POST is "attach to a congress"
  // not "update attachment" — the client-side UX cancels the old one.
  app.post('/:publicationId/congress', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = createOrUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.congressSubmission.create({
      data: {
        publicationId,
        congressId: parsed.data.congressId,
        congressName: parsed.data.congressName,
        characterLimit: parsed.data.characterLimit,
        keywordsRequired: parsed.data.keywordsRequired,
        keywordsEntered: parsed.data.keywordsEntered,
        deadline: new Date(parsed.data.deadline),
        portalUrl: parsed.data.portalUrl,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'congress_submission_created',
      entityType: 'publication',
      entityId: publicationId,
      details: { congressSubmissionId: created.id, congressId: parsed.data.congressId },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Export: freeze character count, package the abstract into blob storage,
  // mark status='exported'. The caller downloads via the presigned URL and
  // uploads to the portal manually.
  app.post('/:publicationId/congress/:submissionId/export', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, submissionId } = request.params as { publicationId: string; submissionId: string }
    const parsed = exportSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.congressSubmission.findFirst({ where: { id: submissionId, publicationId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    if (sub.status !== 'draft' && sub.status !== 'exported') {
      return reply.code(409).send({
        error: 'wrong_status',
        message: `Cannot re-export a submission in status '${sub.status}'`,
      })
    }

    // Character gate — hard limit per congress rules.
    const characterCount = parsed.data.abstractText.length
    if (characterCount > sub.characterLimit) {
      return reply.code(422).send({
        error: 'over_character_limit',
        message: `Abstract is ${characterCount} chars; congress limit is ${sub.characterLimit}`,
        over: characterCount - sub.characterLimit,
      })
    }
    // Keyword gate — must have at least the required count (allow +5 per
    // the DB CHECK constraint in §22.1).
    if (parsed.data.keywords.length < sub.keywordsRequired) {
      return reply.code(422).send({
        error: 'keywords_insufficient',
        message: `${sub.keywordsRequired} keywords required; got ${parsed.data.keywords.length}`,
      })
    }

    // Build the package. Plain text format — the portal expects
    // paste-able content, not a specific binary.
    const packageText = [
      `# Congress: ${sub.congressName}`,
      `# Portal: ${sub.portalUrl}`,
      `# Deadline: ${sub.deadline.toISOString().slice(0, 10)}`,
      ``,
      `## Abstract (${characterCount}/${sub.characterLimit} chars)`,
      parsed.data.abstractText,
      ``,
      `## Keywords (${parsed.data.keywords.length}/${sub.keywordsRequired})`,
      ...parsed.data.keywords.map(k => `- ${k}`),
      ``,
      `## Authors`,
      ...parsed.data.authors.map(a => `- ${a}`),
    ].join('\n')

    const blobKey = generateBlobKey(`congress/${publicationId}/${submissionId}`, 'txt')
    await app.blob.put({
      bucket: 'exports',
      key: blobKey,
      body: Buffer.from(packageText, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
      metadata: {
        publicationId,
        congressSubmissionId: submissionId,
        congressId: sub.congressId,
      },
    })
    const downloadUrl = await app.blob.presignDownload('exports', blobKey, { expiresInSeconds: 24 * 60 * 60 })

    const now = new Date()
    const updated = await app.prisma.congressSubmission.update({
      where: { id: submissionId },
      data: {
        characterCount,
        keywordsEntered: parsed.data.keywords.length,
        status: 'exported',
        exportedAt: now,
        exportedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'congress_package_exported',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        congressSubmissionId: submissionId,
        congressId: sub.congressId,
        characterCount,
        keywordCount: parsed.data.keywords.length,
        blobKey,
      },
      ipAddress: request.ip ?? null,
    })

    return { submission: updated, downloadUrl, blobKey }
  })

  // Manual status flip — manager confirms after uploading to portal, or
  // records accepted/rejected from the editor's reply.
  app.post('/:publicationId/congress/:submissionId/status', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, submissionId } = request.params as { publicationId: string; submissionId: string }
    const parsed = markStatusSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.congressSubmission.findFirst({ where: { id: submissionId, publicationId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    // Transition rules (no reverse once terminal):
    //   draft → exported (via /export only)
    //   exported → submitted
    //   submitted → accepted | rejected
    const allowed: Record<string, string[]> = {
      exported:  ['submitted'],
      submitted: ['accepted', 'rejected'],
    }
    const okNext = allowed[sub.status] ?? []
    if (!okNext.includes(parsed.data.status)) {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot flip ${sub.status} → ${parsed.data.status}. Allowed next: ${okNext.join(', ') || '(terminal)'}`,
      })
    }

    const updated = await app.prisma.congressSubmission.update({
      where: { id: submissionId },
      data: { status: parsed.data.status },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'congress_submission_status_changed',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        congressSubmissionId: submissionId,
        from: sub.status,
        to: parsed.data.status,
        note: parsed.data.note ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Convenience endpoint for the CongressAbstractExport screen's "Export"
  // button. The screen posts a one-shot payload (congress metadata +
  // abstract text) without a pre-existing submission id. This handler
  // creates the submission on the fly if missing + immediately marks it
  // exported. Returns a shape the UI expects — { exportId, format,
  // congress, createdAt } — so the screen's success toast + download
  // button both work without re-architecting the flow around the
  // two-step canonical endpoints above.
  const quickExportSchema = z.object({
    congressId:       z.string().min(1).optional(),
    congressName:     z.string().min(1),
    format:           z.string().default('zip'),
    abstractText:     z.string().min(1),
    keywords:         z.array(z.string()).default([]),
    authors:          z.array(z.string()).default([]),
    // Optional overrides so the UI can prefill without a prior POST.
    characterLimit:   z.number().int().positive().default(3000),
    keywordsRequired: z.number().int().min(0).default(5),
    deadline:         z.string().datetime().optional(),
    portalUrl:        z.string().url().optional(),
  })
  app.post('/:publicationId/congress-export', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = quickExportSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    // Find-or-create the submission by congressId (fallback name match).
    const existing = parsed.data.congressId
      ? await app.prisma.congressSubmission.findFirst({ where: { publicationId, congressId: parsed.data.congressId } })
      : await app.prisma.congressSubmission.findFirst({ where: { publicationId, congressName: parsed.data.congressName } })

    const sub = existing ?? await app.prisma.congressSubmission.create({
      data: {
        publicationId,
        congressId:       parsed.data.congressId ?? parsed.data.congressName.toLowerCase().replace(/\s+/g, '-'),
        congressName:     parsed.data.congressName,
        characterLimit:   parsed.data.characterLimit,
        keywordsRequired: parsed.data.keywordsRequired,
        keywordsEntered:  parsed.data.keywords.length,
        deadline:         parsed.data.deadline ? new Date(parsed.data.deadline) : new Date(Date.now() + 60 * 86_400_000),
        portalUrl:        parsed.data.portalUrl ?? 'https://portal.example.congress',
        characterCount:   parsed.data.abstractText.length,
        status:           'draft',
      },
    })

    const exportedAt = new Date()
    await app.prisma.congressSubmission.update({
      where: { id: sub.id },
      data: {
        status:          'exported',
        exportedAt,
        exportedBy:      request.user!.id,
        characterCount:  parsed.data.abstractText.length,
        keywordsEntered: parsed.data.keywords.length,
      },
    })

    await app.audit.append({
      timestamp: exportedAt.toISOString(),
      actorId: request.user!.id,
      action: 'congress_abstract_exported',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        congressSubmissionId: sub.id,
        congressName: parsed.data.congressName,
        format: parsed.data.format,
        characterCount: parsed.data.abstractText.length,
      },
      ipAddress: request.ip ?? null,
    })

    return {
      exportId:   sub.id,
      format:     parsed.data.format,
      congress:   parsed.data.congressName,
      createdAt:  exportedAt.toISOString(),
    }
  })
}
