// Reference links (FR-A-022): a span of text in a document section linked to an
// uploaded source document. Records are append-only — a DB trigger rejects UPDATE
// and DELETE. "Removing" a link appends a source_reference_removals row instead;
// lists skip removed links, while the link and its removal both stay on record.
//
//   GET  /documents/:documentId/references?sectionId=   list (optionally one section)
//   POST /documents/:documentId/references              create
//   POST /documents/:documentId/references/:referenceId/remove   withdraw a link
//   GET  /documents/:documentId/sources                 source documents the document is based on,
//                                                       with the sections that cite each one

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { isPreviewable, stripExt } from './source-routes.js'
import { suggestSourceCategory } from './source-categories.js'
import { referencesLocked } from '../document-status.js'

const createSchema = z.object({
  sectionId: z.string().trim().min(1).max(200),
  spanText: z.string().trim().min(1, 'Select the text to link').max(2000),
  uploadId: z.string().trim().min(1),
  page: z.number().int().min(1).max(100000).optional(),
  locator: z.string().trim().max(200).optional(),
  // where the span sits in the section's whitespace-collapsed text (see web referenceHighlights.ts)
  startOffset: z.number().int().min(0).max(10_000_000).optional(),
  endOffset: z.number().int().min(1).max(10_000_000).optional(),
}).refine(b => (b.startOffset === undefined) === (b.endOffset === undefined) && (b.startOffset === undefined || b.endOffset! > b.startOffset), {
  message: 'startOffset and endOffset go together, with endOffset after startOffset', path: ['endOffset'],
})

const listQuery = z.object({ sectionId: z.string().trim().min(1).optional() })

const removeSchema = z.object({ reason: z.string().trim().max(500).optional() })

const LOCKED_MESSAGE: Record<string, string> = {
  in_review: 'The document is in review and locked for authoring, so its references can’t be changed.',
  pending_signature: 'The document is awaiting signature, so its references can’t be changed.',
  signed: 'The document is signed, so its references can’t be changed.',
}
const lockedBody = (status: string) => ({ error: 'document_locked', status, message: LOCKED_MESSAGE[status] ?? 'The document is locked, so its references can’t be changed.' })

// Range columns not available yet (migration 36 not applied, or a stale Prisma client):
// P2022 = column missing; a client without the field rejects it as an unknown argument.
const isMissingRangeColumns = (err: unknown) => {
  const e = err as { code?: string; message?: string } | null
  return e?.code === 'P2022' || /Unknown arg(ument)? `(startOffset|endOffset)`/.test(e?.message ?? '')
}

// Removals not available yet: migration 36 not applied (Prisma P2021, table missing), or the
// Prisma client was generated before the model existed (no delegate).
const isMissingTable = (err: unknown) => (err as { code?: string } | null)?.code === 'P2021'

export const documentsReferencesRoutes: FastifyPluginAsync = async (app) => {
  const gate = requireAuth({ modules: ['A'] })

  // Ids of the document's withdrawn links. Before the removals table exists nothing has been removed.
  const removedIds = async (documentId: string): Promise<Set<string>> => {
    if (!app.prisma.sourceReferenceRemoval) return new Set()
    try {
      const rows = await app.prisma.sourceReferenceRemoval.findMany({ where: { documentId }, select: { referenceId: true } })
      return new Set(rows.map(r => r.referenceId))
    } catch (err) {
      if (isMissingTable(err)) return new Set()
      throw err
    }
  }

  app.get('/:documentId/references', { preHandler: gate }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const q = listQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, deletedAt: true } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const [all, removed] = await Promise.all([
      app.prisma.sourceReference.findMany({
        where: { documentId, ...(q.data.sectionId ? { sectionId: q.data.sectionId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
      removedIds(documentId),
    ])
    const rows = all.filter(r => !removed.has(r.id))
    const uploadIds = [...new Set(rows.map(r => r.uploadId))]
    const userIds = [...new Set(rows.map(r => r.createdBy))]
    const [uploads, users] = await Promise.all([
      uploadIds.length ? app.prisma.documentUpload.findMany({ where: { id: { in: uploadIds } } }) : Promise.resolve([]),
      userIds.length ? app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ])
    const uploadById = new Map(uploads.map(u => [u.id, u]))
    const userById = new Map(users.map(u => [u.id, u]))

    return {
      projectId: doc.projectId,
      items: rows.map(r => {
        const u = uploadById.get(r.uploadId)
        return {
          id: r.id,
          documentId: r.documentId,
          sectionId: r.sectionId,
          spanText: r.spanText,
          uploadId: r.uploadId,
          fileName: u?.fileName ?? null,
          contentType: u?.contentType ?? null,
          previewable: u ? isPreviewable(u.contentType) : false,
          page: r.page,
          locator: r.locator,
          startOffset: (r as { startOffset?: number | null }).startOffset ?? null,
          endOffset: (r as { endOffset?: number | null }).endOffset ?? null,
          createdBy: { id: r.createdBy, name: userById.get(r.createdBy)?.name ?? null },
          createdAt: r.createdAt.toISOString(),
        }
      }),
    }
  })

  // Source documents a document is based on: those picked at creation (document_sources)
  // plus any cited from its text (source_references), each with the sections that cite it.
  app.get('/:documentId/sources', { preHandler: gate }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, projectId: true, deletedAt: true, currentVersion: { select: { sections: { select: { sectionId: true, sectionNumber: true, sectionTitle: true } } } } },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const [links, allRefs, removed] = await Promise.all([
      app.prisma.documentSource.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } }),
      app.prisma.sourceReference.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } }),
      removedIds(documentId),
    ])
    const refs = allRefs.filter(r => !removed.has(r.id))
    const uploadIds = [...new Set([...links.map(l => l.uploadId), ...refs.map(r => r.uploadId)])]
    const uploads = uploadIds.length
      ? await app.prisma.documentUpload.findMany({ where: { id: { in: uploadIds }, projectId: doc.projectId } })
      : []
    const uploadById = new Map(uploads.map(u => [u.id, u]))
    const sectionByKey = new Map((doc.currentVersion?.sections ?? []).map(s => [s.sectionId, s]))
    const linkedAt = new Map(links.map(l => [l.uploadId, l.createdAt]))

    const items = uploadIds.flatMap(uploadId => {
      const u = uploadById.get(uploadId)
      if (!u) return []
      const counts = new Map<string, number>()
      for (const r of refs) if (r.uploadId === uploadId) counts.set(r.sectionId, (counts.get(r.sectionId) ?? 0) + 1)
      const sections = [...counts].map(([sectionId, references]) => {
        const s = sectionByKey.get(sectionId)
        return { sectionId, number: s?.sectionNumber ?? null, title: s?.sectionTitle ?? sectionId, references }
      }).sort((a, b) => String(a.number ?? '~').localeCompare(String(b.number ?? '~'), undefined, { numeric: true }))
      return [{
        uploadId,
        title: u.title ?? stripExt(u.fileName),
        fileName: u.fileName,
        category: u.sourceCategory ?? suggestSourceCategory(u.fileName).category,
        origin: u.origin,
        version: u.version,
        contentType: u.contentType,
        previewable: isPreviewable(u.contentType),
        linkedAt: (linkedAt.get(uploadId) ?? u.createdAt).toISOString(),
        sections,
      }]
    })
    return { documentId, items }
  })

  app.post('/:documentId/references', { preHandler: gate }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const body = parsed.data

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, status: true, deletedAt: true } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (referencesLocked(doc.status)) return reply.code(423).send(lockedBody(doc.status))

    // The source must belong to the same project as the document, and be usable.
    const upload = await app.prisma.documentUpload.findFirst({ where: { id: body.uploadId, projectId: doc.projectId } })
    if (!upload) return reply.code(422).send({ error: 'source_not_in_project', message: 'That source document is not part of this project.' })
    if (upload.status !== 'confirmed' || upload.virusScanStatus === 'failed') {
      return reply.code(422).send({ error: 'source_unusable', message: 'That source document is not saved to the library, was rejected, or failed the virus scan and cannot be referenced.' })
    }

    const data = {
      documentId,
      sectionId: body.sectionId,
      spanText: body.spanText,
      uploadId: upload.id,
      page: body.page ?? null,
      locator: body.locator || null,
      createdBy: request.user!.id,
    }
    const range = body.startOffset !== undefined ? { startOffset: body.startOffset, endOffset: body.endOffset! } : null
    let created: Awaited<ReturnType<typeof app.prisma.sourceReference.create>>
    try {
      created = await app.prisma.sourceReference.create({ data: range ? { ...data, ...range } : data })
    } catch (err) {
      // Before the range columns exist, keep the link without its position (located by text, as before).
      if (!range || !isMissingRangeColumns(err)) throw err
      app.log.warn('source_references range columns missing — saved the reference without its position (apply migration 36)')
      created = await app.prisma.sourceReference.create({ data })
    }
    const stored = created as typeof created & { startOffset?: number | null; endOffset?: number | null }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_reference_created',
      entityType: 'document',
      entityId: documentId,
      details: { referenceId: created.id, sectionId: body.sectionId, uploadId: upload.id, fileName: upload.fileName, page: body.page ?? null, startOffset: stored.startOffset ?? null, endOffset: stored.endOffset ?? null },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({
      id: created.id,
      documentId,
      sectionId: created.sectionId,
      spanText: created.spanText,
      uploadId: created.uploadId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      previewable: isPreviewable(upload.contentType),
      page: created.page,
      locator: created.locator,
      startOffset: stored.startOffset ?? null,
      endOffset: stored.endOffset ?? null,
      createdBy: { id: created.createdBy, name: null },
      createdAt: created.createdAt.toISOString(),
    })
  })

  app.post('/:documentId/references/:referenceId/remove', { preHandler: gate }, async (request, reply) => {
    const { documentId, referenceId } = request.params as { documentId: string; referenceId: string }
    const parsed = removeSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, status: true, deletedAt: true } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (referencesLocked(doc.status)) return reply.code(423).send(lockedBody(doc.status))
    const ref = await app.prisma.sourceReference.findFirst({ where: { id: referenceId, documentId } })
    if (!ref) return reply.code(404).send({ error: 'not_found', message: 'That reference is not part of this document.' })
    if ((await removedIds(documentId)).has(ref.id)) {
      return reply.code(409).send({ error: 'already_removed', message: 'That reference has already been removed.' })
    }

    const pending = () => reply.code(503).send({ error: 'migration_pending', message: 'Removing references needs a database update that has not been applied yet. Ask an administrator.' })
    if (!app.prisma.sourceReferenceRemoval) return pending()
    let removal: { id: string; removedAt: Date }
    try {
      removal = await app.prisma.sourceReferenceRemoval.create({
        data: { referenceId: ref.id, documentId, reason: parsed.data.reason || null, removedBy: request.user!.id },
      })
    } catch (err) {
      if (isMissingTable(err)) return pending()
      if ((err as { code?: string }).code === 'P2002') {
        return reply.code(409).send({ error: 'already_removed', message: 'That reference has already been removed.' })
      }
      throw err
    }

    const upload = await app.prisma.documentUpload.findFirst({ where: { id: ref.uploadId, projectId: doc.projectId }, select: { fileName: true } })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_reference_removed',
      entityType: 'document',
      entityId: documentId,
      details: {
        referenceId: ref.id, removalId: removal.id, sectionId: ref.sectionId, uploadId: ref.uploadId,
        fileName: upload?.fileName ?? null, page: ref.page, spanText: ref.spanText.slice(0, 200), reason: parsed.data.reason || null,
      },
      ipAddress: request.ip ?? null,
    })

    return { id: ref.id, removedAt: removal.removedAt.toISOString() }
  })
}
