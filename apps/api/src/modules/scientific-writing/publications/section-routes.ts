// Publication section + version + lock routes — Phase M-B.2 of the
// scientific-writing parity work. Mirror of Module A's section
// patch / lock / version patterns.
//
//   GET    /publications/:id/sections                      — list current-version sections
//   PATCH  /publications/:id/sections/:sectionId           — save HTML on the current version
//   POST   /publications/:id/sections/:sectionId/lock      — acquire / extend
//   DELETE /publications/:id/sections/:sectionId/lock      — release
//   GET    /publications/:id/locks                         — live locks snapshot
//   GET    /publications/:id/versions                      — version list (newest first)
//   POST   /publications/:id/versions/bump                 — create a new version from current
//
// Writes require Module B + edit permission on the publication. For now
// edit permission = any authed user on the publication's project; the
// full PublicationAuthor.raci gate lands in Phase M-B.5.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, hasAnyRole } from '../../../auth/rbac.js'
import {
  PublicationSectionService,
  PublicationSectionServiceError,
} from './section-service.js'
import {
  acquirePublicationLock,
  getPublicationLockHolder,
  listPublicationLocks,
  releasePublicationLock,
  requirePublicationLockHeldBy,
  PUBLICATION_LOCK_STALE_SECONDS,
} from './section-lock-service.js'

const gate      = requireAuth({ modules: ['B'] })
const writeGate = requireAuth({ modules: ['B'] })

// Full PublicationAuthor.raci gating lands in Phase M-B.5. For now any
// authed Module-B user can edit; auditor-read-only + guests are already
// blocked at the gate.

const patchSectionSchema = z.object({
  contentHtml: z.string().max(5_000_000),
})

const bumpSchema = z.object({
  label:            z.string().min(1).max(80),
  newVersionNumber: z.string().regex(/^v\d+\.\d+$/, 'use vN.M'),
  note:             z.string().max(500).optional(),
})

export const publicationSectionRoutes: FastifyPluginAsync = async (app) => {
  const sectionSvc = new PublicationSectionService(app.prisma)

  function mapError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof PublicationSectionServiceError)) return null
    switch (err.code) {
      case 'no_current_version': return { code: 409, body: { error: 'no_current_version', message: err.message } }
      case 'section_not_found':  return { code: 404, body: { error: 'section_not_found',  message: err.message } }
    }
  }

  // --- GET /publications/:id/sections ------------------------------------
  app.get('/:id/sections', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    const sections = await sectionSvc.listCurrentSections(id)
    return {
      publicationId: id,
      sections:      sections.map(s => ({
        id:            s.id,
        sectionId:     s.sectionId,
        sectionNumber: s.sectionNumber,
        sectionTitle:  s.sectionTitle,
        contentHtml:   s.contentHtml,
        wordCount:     s.wordCount,
        aiConfidence:  s.aiConfidence,
        aiFlags:       s.aiFlags,
        lastEditedBy:  s.lastEditedBy,
        lastEditedAt:  s.lastEditedAt?.toISOString() ?? null,
      })),
    }
  })

  // --- PATCH /publications/:id/sections/:sectionId -----------------------
  app.patch('/:id/sections/:sectionId', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = patchSectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // Lock gate — mirror sPM-autosave on Module A. Another live holder blocks.
    const blocker = await requirePublicationLockHeldBy(app.prisma, {
      publicationId: id, sectionId, userId: request.user!.id,
    })
    if (blocker) {
      return reply.code(423).send({
        error:        'locked',
        holder:       blocker,
        staleSeconds: PUBLICATION_LOCK_STALE_SECONDS,
      })
    }

    try {
      const row = await sectionSvc.upsertSectionContent({
        publicationId: id,
        sectionId,
        contentHtml:   parsed.data.contentHtml,
        actorId:       request.user!.id,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_section_edited',
        entityType: 'publication',
        entityId:   id,
        details:    { sectionId, wordCount: row.wordCount, htmlChars: parsed.data.contentHtml.length },
        ipAddress:  request.ip ?? null,
      })
      return {
        id:           row.id,
        sectionId:    row.sectionId,
        contentHtml:  row.contentHtml,
        wordCount:    row.wordCount,
        lastEditedAt: row.lastEditedAt?.toISOString() ?? null,
      }
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // --- POST /publications/:id/sections/:sectionId/lock -------------------
  app.post('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const result = await acquirePublicationLock(app.prisma, {
      publicationId: id, sectionId, userId: request.user!.id,
    })
    if (result.outcome === 'conflict') {
      return reply.code(423).send({
        error:        'locked',
        holder:       result.holder,
        staleSeconds: PUBLICATION_LOCK_STALE_SECONDS,
      })
    }
    if (result.outcome === 'acquired' || result.outcome === 'stolen') {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     result.outcome === 'stolen' ? 'publication_section_lock_stolen' : 'publication_section_lock_acquired',
        entityType: 'publication',
        entityId:   id,
        details:    { sectionId },
        ipAddress:  request.ip ?? null,
      })
    }
    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome:      result.outcome,
      holder:       result.holder,
      staleSeconds: PUBLICATION_LOCK_STALE_SECONDS,
    })
  })

  // --- DELETE /publications/:id/sections/:sectionId/lock -----------------
  app.delete('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const isAdmin = hasAnyRole(request.user!, 'admin')
    const existing = await getPublicationLockHolder(app.prisma, { publicationId: id, sectionId })
    const released = await releasePublicationLock(app.prisma, {
      publicationId: id, sectionId, userId: request.user!.id, force: isAdmin,
    })
    if (released && existing && existing.userId !== request.user!.id) {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_section_lock_force_released',
        entityType: 'publication',
        entityId:   id,
        details:    { sectionId, previousHolderId: existing.userId },
        ipAddress:  request.ip ?? null,
      })
    }
    return { released }
  })

  // --- GET /publications/:id/locks ---------------------------------------
  app.get('/:id/locks', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    const locks = await listPublicationLocks(app.prisma, id)
    return { publicationId: id, staleSeconds: PUBLICATION_LOCK_STALE_SECONDS, locks }
  })

  // --- GET /publications/:id/versions ------------------------------------
  app.get('/:id/versions', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true, currentVersionId: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    const versions = await sectionSvc.listVersions(id)
    return {
      publicationId:    id,
      currentVersionId: pub.currentVersionId,
      versions: versions.map(v => ({
        id:            v.id,
        versionNumber: v.versionNumber,
        label:         v.label,
        isCurrent:     v.isCurrent,
        createdBy:     v.createdBy,
        createdAt:     v.createdAt.toISOString(),
      })),
    }
  })

  // --- POST /publications/:id/versions/bump ------------------------------
  app.post('/:id/versions/bump', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = bumpSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const pub = await app.prisma.publication.findUnique({
      where: { id }, select: { id: true, deletedAt: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    try {
      const version = await sectionSvc.bumpVersion({
        publicationId:    id,
        label:            parsed.data.label,
        newVersionNumber: parsed.data.newVersionNumber,
        actorId:          request.user!.id,
        note:             parsed.data.note,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_version_bumped',
        entityType: 'publication',
        entityId:   id,
        details:    { versionNumber: version.versionNumber, label: version.label, note: parsed.data.note ?? null },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send({
        id:            version.id,
        versionNumber: version.versionNumber,
        label:         version.label,
        createdAt:     version.createdAt.toISOString(),
      })
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}
