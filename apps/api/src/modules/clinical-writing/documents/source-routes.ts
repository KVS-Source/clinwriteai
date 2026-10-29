// Per-project source-document library (Module A).
//
//   GET /projects/:projectId/source-documents                    list (search / filter / sort / page)
//   GET /projects/:projectId/source-documents/:uploadId/download  the original file
//
// "Source documents" are the files uploaded through "Upload source document"
// (document_uploads rows + the bytes in the 'documents' bucket). They are evidence,
// not authored documents; the documents written from them are in document_sources.
// Only files the user saved to the library are listed. An upload that was never saved
// ("Save to library" not pressed) stays status='pending_classification' and is invisible
// here; cancelling the upload form discards it (DELETE below). A listed source is:
//   - saved     → saved to the library (category / title set)
//   - rejected  → explicitly rejected
//
// Filtering / sorting / paging happen in memory: a project holds tens to low
// hundreds of source files, and the sortable "title" is derived (the linked
// document's title, else the file name), so it can't be an ORDER BY.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { SOURCE_CATEGORY_LABEL, suggestSourceCategory, type SourceCategory } from './source-categories.js'

const SORT_KEYS = ['title', 'file', 'category', 'state', 'scan', 'usedIn', 'size', 'uploaded'] as const
type SortKey = (typeof SORT_KEYS)[number]

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum(['all', 'saved', 'rejected']).default('all'),
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
  title: string | null
  sourceCategory: string | null
  origin: string | null
  version: string | null
  createdAt: Date
}

export type SourceState = 'saved' | 'rejected'

function stateOf(row: Pick<UploadRow, 'status'>): SourceState {
  return row.status === 'rejected' ? 'rejected' : 'saved'
}

export function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// Formats the viewer panel can show. PDF / images are streamed as-is; DOCX is converted to HTML
// and plain-text formats are sent as text/plain — both are shown in a script-less sandboxed frame.
// Deliberately no SVG/HTML (script-capable) and no legacy Office formats (no converter).
export const PREVIEW_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TEXT_TYPES = ['text/plain', 'text/csv', 'application/csv', 'text/markdown', 'application/json'] as const
const TEXT_EXTS = ['.txt', '.csv', '.md', '.json'] as const

const baseType = (contentType: string) => contentType.toLowerCase().split(';')[0]!.trim()

export type PreviewKind = 'binary' | 'docx' | 'text'
// The file name is only a fallback for text files that browsers/OSes label with an odd type
// (a CSV arrives as application/vnd.ms-excel, application/x-csv, octet-stream, empty, …). It never
// overrides a type we already know is something else, and the bytes are served as inert text/plain.
export function previewKind(contentType: string, fileName?: string): PreviewKind | null {
  const t = baseType(contentType)
  if ((PREVIEW_TYPES as readonly string[]).includes(t)) return 'binary'
  if (t === DOCX_TYPE) return 'docx'
  if ((TEXT_TYPES as readonly string[]).includes(t)) return 'text'
  const name = fileName?.toLowerCase() ?? ''
  const knownOther = t.startsWith('image/') || t.startsWith('video/') || t.startsWith('audio/') || t.includes('html') || t.includes('xml') || t.startsWith('application/vnd.openxmlformats') || t === 'application/msword' || t === 'application/pdf'
  if (!knownOther && TEXT_EXTS.some(e => name.endsWith(e))) return 'text'
  return null
}
export const isPreviewable = (contentType: string, fileName?: string) => previewKind(contentType, fileName) !== null

async function docxToHtml(body: Buffer): Promise<Buffer> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.convertToHtml({ buffer: body })
  const doc = `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:16px auto;padding:0 16px;color:#0f172a}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}img{max-width:100%}</style>${value}`
  return Buffer.from(doc, 'utf8')
}

// Content-Disposition filename: an ASCII fallback plus the RFC 5987 UTF-8 form.
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

// A blob read can fail because the object really isn't there (local ENOENT / S3 NoSuchKey) or because
// storage itself is unhealthy (unreachable, bad credentials, timeout). Only the first is "file missing".
export function isMissingBlob(err: unknown): boolean {
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } } | null
  return e?.code === 'ENOENT' || e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

const cmp = (a: string | number, b: string | number) =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })

export const documentsSourceRoutes: FastifyPluginAsync = async (app) => {
  const gate = requireAuth({ modules: ['A'] })

  // `?documentId=` on view/download: the file was opened from that document (editor source
  // panel), so the audit entry goes on the document's trail instead of the upload's.
  const openedFromDocument = async (query: unknown, projectId: string): Promise<string | null> => {
    const id = (query as { documentId?: unknown } | null)?.documentId
    if (typeof id !== 'string' || !id) return null
    const doc = await app.prisma.document.findFirst({ where: { id, projectId, deletedAt: null }, select: { id: true } })
    return doc?.id ?? null
  }

  app.get('/:projectId/source-documents', { preHandler: gate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { q, state, sort, dir, page, pageSize } = parsed.data

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = (await app.prisma.documentUpload.findMany({
      where: { projectId, status: { in: ['confirmed', 'rejected'] } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })) as UploadRow[]

    // Documents each source is used in (document_sources) and the uploaders' names,
    // fetched as batched reads.
    const uploadIds = rows.map(r => r.id)
    const userIds = [...new Set(rows.map(r => r.uploadedBy))]
    const links = uploadIds.length
      ? await app.prisma.documentSource.findMany({ where: { uploadId: { in: uploadIds } }, orderBy: { createdAt: 'asc' } })
      : []
    const docIds = [...new Set(links.map(l => l.documentId))]
    const [docs, users] = await Promise.all([
      docIds.length ? app.prisma.document.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true, title: true } }) : Promise.resolve([]),
      userIds.length ? app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    ])
    const docById = new Map(docs.map(d => [d.id, d]))
    const userById = new Map(users.map(u => [u.id, u]))
    const usedInByUpload = new Map<string, Array<{ id: string; title: string }>>()
    for (const l of links) {
      const d = docById.get(l.documentId)
      if (!d) continue
      usedInByUpload.set(l.uploadId, [...(usedInByUpload.get(l.uploadId) ?? []), { id: d.id, title: d.title }])
    }

    const all = rows.map(r => {
      const uploader = userById.get(r.uploadedBy)
      // Rows saved before categories existed fall back to a filename guess (never to a real
      // category it can't justify — see suggestSourceCategory).
      const guess = r.sourceCategory ? null : suggestSourceCategory(r.fileName)
      return {
        id: r.id,
        title: r.title ?? stripExt(r.fileName),
        fileName: r.fileName,
        fileSizeBytes: r.fileSizeBytes,
        contentType: r.contentType,
        previewable: isPreviewable(r.contentType, r.fileName),
        category: r.sourceCategory ?? guess!.category,
        categorySource: r.sourceCategory ? ('set' as const) : ('detected' as const),
        origin: r.origin,
        version: r.version,
        state: stateOf(r),
        virusScanStatus: r.virusScanStatus,
        usedIn: usedInByUpload.get(r.id) ?? [],
        uploadedBy: { id: r.uploadedBy, name: uploader?.name ?? null, email: uploader?.email ?? null },
        uploadedAt: r.createdAt.toISOString(),
      }
    })

    const summary = {
      files: all.length,
      saved: all.filter(r => r.state === 'saved').length,
      rejected: all.filter(r => r.state === 'rejected').length,
    }

    const needle = q?.toLowerCase()
    const filtered = all.filter(r =>
      (state === 'all' || r.state === state) &&
      (!needle || [r.title, r.fileName, r.origin ?? '', r.category, SOURCE_CATEGORY_LABEL[r.category as SourceCategory] ?? '', ...r.usedIn.map(d => d.title), r.uploadedBy.name ?? '', r.uploadedBy.email ?? '']
        .some(s => s.toLowerCase().includes(needle))),
    )

    const key: Record<SortKey, (r: (typeof all)[number]) => string | number> = {
      title: r => r.title,
      file: r => r.fileName,
      category: r => r.category,
      state: r => r.state,
      scan: r => r.virusScanStatus,
      usedIn: r => r.usedIn.length,
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

  // Discard an upload that was never saved to the library (the user cancelled the upload form).
  // Saved sources are never deleted here — only status='pending_classification'.
  app.delete('/:projectId/source-documents/:uploadId', { preHandler: gate }, async (request, reply) => {
    const { projectId, uploadId } = request.params as { projectId: string; uploadId: string }
    const row = await app.prisma.documentUpload.findFirst({ where: { id: uploadId, projectId } }) as UploadRow | null
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.status !== 'pending_classification') {
      return reply.code(409).send({ error: 'not_discardable', message: 'Only an upload that was not saved to the library can be discarded.' })
    }

    // Best effort: the row is what makes the file visible, so it goes even if the bytes are already gone.
    await app.blob.del('documents', row.blobKey).catch(err => app.log.warn({ err, uploadId, blobKey: row.blobKey }, 'discarded upload: blob delete failed'))
    await app.prisma.documentUpload.delete({ where: { id: row.id } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_upload_discarded',
      entityType: 'document_upload',
      entityId: row.id,
      details: { projectId, fileName: row.fileName, fileSizeBytes: row.fileSizeBytes },
      ipAddress: request.ip ?? null,
    })
    return reply.code(204).send()
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
      if (isMissingBlob(err)) {
        app.log.warn({ err, uploadId, blobKey: row.blobKey }, 'source document bytes missing from storage')
        return reply.code(404).send({ error: 'file_missing', message: 'The stored file could not be found.' })
      }
      app.log.error({ err, uploadId, blobKey: row.blobKey }, 'source document storage read failed')
      return reply.code(502).send({ error: 'storage_unavailable', message: 'The file storage could not be reached. Try again shortly, or contact an administrator if it keeps happening.' })
    }

    const fromDoc = await openedFromDocument(request.query, projectId)
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_document_downloaded',
      entityType: fromDoc ? 'document' : 'document_upload',
      entityId: fromDoc ?? row.id,
      details: { projectId, uploadId: row.id, fileName: row.fileName, fileSizeBytes: row.fileSizeBytes },
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
    const kind = previewKind(row.contentType, row.fileName)
    if (!kind) {
      return reply.code(415).send({ error: 'not_previewable', message: 'This file type cannot be viewed here. Download the file instead.' })
    }

    let file: { body: Buffer; contentType: string | null }
    try {
      file = await app.blob.get('documents', row.blobKey)
    } catch (err) {
      if (isMissingBlob(err)) {
        app.log.warn({ err, uploadId, blobKey: row.blobKey }, 'source document bytes missing from storage')
        return reply.code(404).send({ error: 'file_missing', message: 'The stored file could not be found.' })
      }
      app.log.error({ err, uploadId, blobKey: row.blobKey }, 'source document storage read failed')
      return reply.code(502).send({ error: 'storage_unavailable', message: 'The file storage could not be reached. Try again shortly, or contact an administrator if it keeps happening.' })
    }

    const fromDoc = await openedFromDocument(request.query, projectId)
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_document_viewed',
      entityType: fromDoc ? 'document' : 'document_upload',
      entityId: fromDoc ?? row.id,
      details: { projectId, uploadId: row.id, fileName: row.fileName },
      ipAddress: request.ip ?? null,
    })

    if (kind === 'binary') {
      return reply
        .header('Content-Type', baseType(row.contentType))
        .header('Content-Disposition', contentDisposition(row.fileName).replace('attachment', 'inline'))
        .header('Content-Length', String(file.body.length))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(file.body)
    }

    // docx → HTML, text → text/plain. Locked down so nothing in the file can run or load anything.
    let body: Buffer
    try {
      body = kind === 'docx' ? await docxToHtml(file.body) : file.body
    } catch (err) {
      app.log.warn({ err, uploadId }, 'source document preview conversion failed')
      return reply.code(422).send({ error: 'preview_failed', message: 'This file could not be converted for viewing. Download it instead.' })
    }
    return reply
      .header('Content-Type', kind === 'docx' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8')
      .header('Content-Disposition', 'inline')
      .header('Content-Length', String(body.length))
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(body)
  })
}
