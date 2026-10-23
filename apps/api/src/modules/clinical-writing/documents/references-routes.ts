// Reference links (FR-A-022): a span of text in a document section linked to an
// uploaded source document. Records are append-only — there is deliberately no
// update or delete route, and a DB trigger rejects both.
//
//   GET  /documents/:documentId/references?sectionId=   list (optionally one section)
//   POST /documents/:documentId/references              create
//   GET  /documents/:documentId/sources                 source documents the document is based on,
//                                                       with the sections that cite each one

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { isPreviewable, stripExt } from './source-routes.js'
import { suggestSourceCategory } from './source-categories.js'

const createSchema = z.object({
  sectionId: z.string().trim().min(1).max(200),
  spanText: z.string().trim().min(1, 'Select the text to link').max(2000),
  uploadId: z.string().trim().min(1),
  page: z.number().int().min(1).max(100000).optional(),
  locator: z.string().trim().max(200).optional(),
})

const listQuery = z.object({ sectionId: z.string().trim().min(1).optional() })

export const documentsReferencesRoutes: FastifyPluginAsync = async (app) => {
  const gate = requireAuth({ modules: ['A'] })

  app.get('/:documentId/references', { preHandler: gate }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const q = listQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, deletedAt: true } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.sourceReference.findMany({
      where: { documentId, ...(q.data.sectionId ? { sectionId: q.data.sectionId } : {}) },
      orderBy: { createdAt: 'asc' },
    })
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

    const [links, refs] = await Promise.all([
      app.prisma.documentSource.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } }),
      app.prisma.sourceReference.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } }),
    ])
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

    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, deletedAt: true } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // The source must belong to the same project as the document, and be usable.
    const upload = await app.prisma.documentUpload.findFirst({ where: { id: body.uploadId, projectId: doc.projectId } })
    if (!upload) return reply.code(422).send({ error: 'source_not_in_project', message: 'That source document is not part of this project.' })
    if (upload.status !== 'confirmed' || upload.virusScanStatus === 'failed') {
      return reply.code(422).send({ error: 'source_unusable', message: 'That source document is not saved to the library, was rejected, or failed the virus scan and cannot be referenced.' })
    }

    const created = await app.prisma.sourceReference.create({
      data: {
        documentId,
        sectionId: body.sectionId,
        spanText: body.spanText,
        uploadId: upload.id,
        page: body.page ?? null,
        locator: body.locator || null,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_reference_created',
      entityType: 'document',
      entityId: documentId,
      details: { referenceId: created.id, sectionId: body.sectionId, uploadId: upload.id, fileName: upload.fileName, page: body.page ?? null },
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
      createdBy: { id: created.createdBy, name: null },
      createdAt: created.createdAt.toISOString(),
    })
  })
}
