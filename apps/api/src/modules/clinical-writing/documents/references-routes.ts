// Reference links (FR-A-022): a span of text in a document section linked to an
// uploaded source document. Records are append-only — there is deliberately no
// update or delete route, and a DB trigger rejects both.
//
//   GET  /documents/:documentId/references?sectionId=   list (optionally one section)
//   POST /documents/:documentId/references              create

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { isPreviewable } from './source-routes.js'

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
    if (upload.status === 'rejected' || upload.virusScanStatus === 'failed') {
      return reply.code(422).send({ error: 'source_unusable', message: 'That source document was rejected or failed the virus scan and cannot be referenced.' })
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
