// Per-project source-document library (Module A).
//
//   GET /projects/:projectId/source-documents                    list (search / filter / sort / page)
//   GET /projects/:projectId/source-documents/:uploadId/download  the original file
//
// "Source documents" are the files uploaded through "Upload source document"
// (document_uploads rows + the bytes in the 'documents' bucket). Until now they
// were stored but could not be listed or opened. A source document is:
//   - linked    → it was confirmed and became a Document (documentId set)
//   - pending   → uploaded but classification not confirmed yet
//   - rejected  → explicitly rejected
//
// Filtering / sorting / paging happen in memory: a project holds tens to low
// hundreds of source files, and the sortable "title" is derived (the linked
// document's title, else the file name), so it can't be an ORDER BY.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const SORT_KEYS = ['title', 'file', 'type', 'state', 'size', 'uploaded'] as const
type SortKey = (typeof SORT_KEYS)[number]

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum(['all', 'linked', 'pending', 'rejected']).default('all'),
  sort: z.enum(SORT_KEYS).default('uploaded'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(n => [10, 25, 50, 100].includes(n), 'pageSize must be 10, 25, 50 or 100').default(50),
})

type UploadRow = {
  id: string
  projectId: string
  uploadedBy: string
  blobKey: string
  fileName: string
  fileSizeBytes: number
  contentType: string
  virusScanStatus: string
  classification: unknown
  status: string
  documentId: string | null
  createdAt: Date
}

export type SourceState = 'linked' | 'pending' | 'rejected'

function stateOf(row: Pick<UploadRow, 'status' | 'documentId'>): SourceState {
  if (row.status === 'rejected') return 'rejected'
  if (row.status === 'confirmed' && row.documentId) return 'linked'
  return 'pending'
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// The upload classifier guesses from the file name and falls back to "protocol" at low
// confidence when it can't tell. Surface a guess only when it was reasonably sure, so a
// listing or a scan isn't presented as a Protocol.
const MIN_DETECTION_CONFIDENCE = 70

function detectedType(classification: unknown): string | null {
  const c = classification as { documentType?: unknown; typeConfidence?: unknown } | null
  if (typeof c?.documentType !== 'string') return null
  return typeof c.typeConfidence === 'number' && c.typeConfidence >= MIN_DETECTION_CONFIDENCE ? c.documentType : null
}

// Only formats the browser can render safely inside the viewer panel. Deliberately no SVG/HTML
// (script-capable) and no Office formats (no converter yet).
export const PREVIEW_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const isPreviewable = (contentType: string) =>
  (PREVIEW_TYPES as readonly string[]).includes(contentType.toLowerCase().split(';')[0]!.trim())

// Content-Disposition filename: an ASCII fallback plus the RFC 5987 UTF-8 form.
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

const cmp = (a: string | number, b: string | number) =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })

export const documentsSourceRoutes: FastifyPluginAsync = async (app) => {
  const gate = requireAuth({ modules: ['A'] })

  app.get('/:projectId/source-documents', { preHandler: gate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { q, state, sort, dir, page, pageSize } = parsed.data

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = (await app.prisma.documentUpload.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })) as UploadRow[]

    // Names for the linked documents and the uploaders, fetched in two batched reads.
    const docIds = [...new Set(rows.map(r => r.documentId).filter((x): x is string => !!x))]
    const userIds = [...new Set(rows.map(r => r.uploadedBy))]
    const [docs, users] = await Promise.all([
      docIds.length ? app.prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, title: true, type: true } }) : Promise.resolve([]),
      userIds.length ? app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    ])
    const docById = new Map(docs.map(d => [d.id, d]))
    const userById = new Map(users.map(u => [u.id, u]))

    const all = rows.map(r => {
      const doc = r.documentId ? docById.get(r.documentId) : undefined
      const uploader = userById.get(r.uploadedBy)
      return {
        id: r.id,
        title: doc?.title ?? stripExt(r.fileName),
        fileName: r.fileName,
        fileSizeBytes: r.fileSizeBytes,
        contentType: r.contentType,
        previewable: isPreviewable(r.contentType),
        // Linked: the real document's type. Otherwise the classifier's guess (if confident).
        documentType: (doc?.type as string | undefined) ?? detectedType(r.classification),
        documentTypeSource: doc?.type ? ('document' as const) : detectedType(r.classification) ? ('detected' as const) : null,
        state: stateOf(r),
        virusScanStatus: r.virusScanStatus,
        documentId: r.documentId,
        documentTitle: doc?.title ?? null,
        uploadedBy: { id: r.uploadedBy, name: uploader?.name ?? null, email: uploader?.email ?? null },
        uploadedAt: r.createdAt.toISOString(),
      }
    })

    const summary = {
      files: all.length,
      linked: all.filter(r => r.state === 'linked').length,
      pending: all.filter(r => r.state === 'pending').length,
      rejected: all.filter(r => r.state === 'rejected').length,
    }

    const needle = q?.toLowerCase()
    const filtered = all.filter(r =>
      (state === 'all' || r.state === state) &&
      (!needle || [r.title, r.fileName, r.documentTitle ?? '', r.uploadedBy.name ?? '', r.uploadedBy.email ?? '']
        .some(s => s.toLowerCase().includes(needle))),
    )

    const key: Record<SortKey, (r: (typeof all)[number]) => string | number> = {
      title: r => r.title,
      file: r => r.fileName,
      type: r => r.documentType ?? '',
      state: r => r.state,
      size: r => r.fileSizeBytes,
      uploaded: r => new Date(r.uploadedAt).getTime(),
    }
    const sorted = [...filtered].sort((a, b) => {
      const c = cmp(key[sort](a), key[sort](b))
      // Stable, deterministic tie-break so paging never shuffles rows.
      return (dir === 'asc' ? c : -c) || cmp(a.id, b.id)
    })

    const start = (page - 1) * pageSize
    return {
      items: sorted.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      summary,
    }
  })

  app.get('/:projectId/source-documents/:uploadId/download', { preHandler: gate }, async (request, reply) => {
    const { projectId, uploadId } = request.params as { projectId: string; uploadId: string }
    // Scope by project so one project's upload id can't be fetched through another's URL.
    const row = await app.prisma.documentUpload.findFirst({ where: { id: uploadId, projectId } }) as UploadRow | null
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.virusScanStatus === 'failed') {
      return reply.code(403).send({ error: 'quarantined', message: 'This file failed the virus scan and cannot be downloaded.' })
    }

    let file: { body: Buffer; contentType: string | null }
    try {
      file = await app.blob.get('documents', row.blobKey)
    } catch (err) {
      app.log.warn({ err, uploadId, blobKey: row.blobKey }, 'source document bytes missing from storage')
      return reply.code(404).send({ error: 'file_missing', message: 'The stored file could not be found.' })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_document_downloaded',
      entityType: 'document_upload',
      entityId: row.id,
      details: { projectId, fileName: row.fileName, fileSizeBytes: row.fileSizeBytes },
      ipAddress: request.ip ?? null,
    })

    // `attachment` (never inline) so an uploaded HTML/SVG-looking file can't
    // run in our origin; nosniff stops the browser second-guessing the type.
    return reply
      .header('Content-Type', row.contentType || file.contentType || 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(row.fileName))
      .header('Content-Length', String(file.body.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(file.body)
  })

  // Inline viewing in the right-hand panel. Same guards as download, but only for the
  // allow-listed PDF / image types; the type is the one recorded at upload, never sniffed.
  app.get('/:projectId/source-documents/:uploadId/preview', { preHandler: gate }, async (request, reply) => {
    const { projectId, uploadId } = request.params as { projectId: string; uploadId: string }
    const row = await app.prisma.documentUpload.findFirst({ where: { id: uploadId, projectId } }) as UploadRow | null
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.virusScanStatus === 'failed') {
      return reply.code(403).send({ error: 'quarantined', message: 'This file failed the virus scan and cannot be opened.' })
    }
    if (!isPreviewable(row.contentType)) {
      return reply.code(415).send({ error: 'not_previewable', message: 'Only PDF and image files can be viewed here. Download the file instead.' })
    }

    let file: { body: Buffer; contentType: string | null }
    try {
      file = await app.blob.get('documents', row.blobKey)
    } catch (err) {
      app.log.warn({ err, uploadId, blobKey: row.blobKey }, 'source document bytes missing from storage')
      return reply.code(404).send({ error: 'file_missing', message: 'The stored file could not be found.' })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_document_viewed',
      entityType: 'document_upload',
      entityId: row.id,
      details: { projectId, fileName: row.fileName },
      ipAddress: request.ip ?? null,
    })

    return reply
      .header('Content-Type', row.contentType.split(';')[0]!.trim())
      .header('Content-Disposition', contentDisposition(row.fileName).replace('attachment', 'inline'))
      .header('Content-Length', String(file.body.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(file.body)
  })
}
