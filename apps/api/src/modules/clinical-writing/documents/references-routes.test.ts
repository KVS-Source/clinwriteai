// Reference links (FR-A-022) and the inline source preview, through Fastify inject()
// with a stubbed Prisma + blob store.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsReferencesRoutes } from './references-routes.js'
vi.mock('mammoth', () => ({
  default: {},
  convertToHtml: async ({ buffer }: { buffer: Buffer }) => {
    if (buffer.toString() === 'corrupt') throw new Error('bad docx')
    return { value: '<p>Hello</p>' }
  },
}))
import { documentsSourceRoutes, isPreviewable } from './source-routes.js'

type Upload = {
  id: string; projectId: string; uploadedBy: string; blobKey: string; fileName: string; fileSizeBytes: number
  contentType: string; virusScanStatus: string; classification: unknown; status: string; documentId: string | null; createdAt: Date
}
const up = (over: Partial<Upload> & Pick<Upload, 'id' | 'fileName'>): Upload => ({
  projectId: 'proj-1', uploadedBy: 'u1', blobKey: `proj-1/pending-uploads/${over.id}`, fileSizeBytes: 1000,
  contentType: 'application/pdf', virusScanStatus: 'passed', classification: null, status: 'confirmed',
  documentId: null, createdAt: new Date('2026-10-20T10:00:00Z'), ...over,
})
const UPLOADS: Upload[] = [
  up({ id: 'pdf1', fileName: 'Protocol.pdf' }),
  up({ id: 'img1', fileName: 'scan.png', contentType: 'image/png' }),
  up({ id: 'docx1', fileName: 'SAP.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  up({ id: 'svg1', fileName: 'x.svg', contentType: 'image/svg+xml' }),
  up({ id: 'doc1', fileName: 'old.doc', contentType: 'application/msword' }),
  up({ id: 'csv1', fileName: 'TEAE.csv', contentType: 'application/vnd.ms-excel' }),
  up({ id: 'bad', fileName: 'bad.pdf', virusScanStatus: 'failed' }),
  up({ id: 'rej', fileName: 'rej.pdf', status: 'rejected' }),
  up({ id: 'unsaved', fileName: 'unsaved.pdf', status: 'pending_classification' }),
  up({ id: 'foreign', projectId: 'proj-2', fileName: 'foreign.pdf' }),
]

const REFS = [
  { id: 'r1', documentId: 'DOC-1', sectionId: 's1', spanText: 'PFS was 11.2 months', uploadId: 'pdf1', page: 42, locator: '§9.4', createdBy: 'viewer', createdAt: new Date('2026-10-22T09:00:00Z') },
  { id: 'r2', documentId: 'DOC-1', sectionId: 's2', spanText: 'AE listing', uploadId: 'docx1', page: null, locator: null, createdBy: 'viewer', createdAt: new Date('2026-10-22T09:05:00Z') },
]

async function build(
  blobGet = vi.fn(async () => ({ body: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' })),
  { removalsTable = true, docStatus = 'in_authoring' }: { removalsTable?: boolean; docStatus?: string } = {},
) {
  const created: Array<Record<string, unknown>> = []
  const removals: Array<{ id: string; referenceId: string; documentId: string; reason: string | null; removedBy: string; removedAt: Date }> = []
  const missingTable = () => { throw Object.assign(new Error('table does not exist'), { code: 'P2021' }) }
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1' })) },
    document: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'DOC-1' ? { id: 'DOC-1', projectId: 'proj-1', status: docStatus, deletedAt: null } : where.id === 'DOC-GONE' ? { id: 'DOC-GONE', projectId: 'proj-1', status: 'in_authoring', deletedAt: new Date() } : null),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
        where.id === 'DOC-1' && where.projectId === 'proj-1' ? { id: 'DOC-1' } : null),
    },
    documentUpload: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) => UPLOADS.find(u => u.id === where.id && u.projectId === where.projectId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) => UPLOADS.filter(u => where.id?.in.includes(u.id))),
    },
    user: { findMany: vi.fn(async () => [{ id: 'viewer', name: 'Priya Nair', email: 'p@x.io' }]) },
    documentSource: { findMany: vi.fn(async () => []) },
    sourceReference: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: 'ref-1', createdAt: new Date('2026-10-22T09:00:00Z'), ...data }; created.push(row); return row }),
      findMany: vi.fn(async ({ where }: { where: { documentId: string; sectionId?: string } }) =>
        REFS.filter(r => r.documentId === where.documentId && (!where.sectionId || r.sectionId === where.sectionId))),
      findFirst: vi.fn(async ({ where }: { where: { id: string; documentId: string } }) =>
        REFS.find(r => r.id === where.id && r.documentId === where.documentId) ?? null),
    },
    sourceReferenceRemoval: {
      findMany: vi.fn(async ({ where }: { where: { documentId: string } }) =>
        removalsTable ? removals.filter(r => r.documentId === where.documentId) : missingTable()),
      create: vi.fn(async ({ data }: { data: { referenceId: string; documentId: string; reason: string | null; removedBy: string } }) => {
        if (!removalsTable) missingTable()
        const row = { id: `rm-${removals.length + 1}`, removedAt: new Date('2026-10-23T09:00:00Z'), ...data }
        removals.push(row)
        return row
      }),
    },
  } as never)
  app.decorate('blob', { get: blobGet } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'viewer', email: 'v@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })
  await app.register(documentsSourceRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, created, removals, audit, blobGet }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

const post = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown, id = 'DOC-1') =>
  app.inject({ method: 'POST', url: `/documents/${id}/references`, payload: payload as never })

describe('POST /documents/:id/references', () => {
  it('creates a reference link, records who made it and audits it', async () => {
    const { app, created, audit } = await build()
    const res = await post(app, { sectionId: 's1', spanText: '  PFS was 11.2 months ', uploadId: 'pdf1', page: 42, locator: '§9.4' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ id: 'ref-1', spanText: 'PFS was 11.2 months', fileName: 'Protocol.pdf', previewable: true, page: 42, locator: '§9.4' })
    expect(created[0]).toMatchObject({ documentId: 'DOC-1', sectionId: 's1', uploadId: 'pdf1', page: 42, createdBy: 'viewer' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'source_reference_created', entityId: 'DOC-1', actorId: 'viewer' }))
  })

  it('stores the span’s range in the section, so repeated wording links to the right place', async () => {
    const { app, created } = await build()
    const res = await post(app, { sectionId: 's1', spanText: 'PFS', uploadId: 'pdf1', startOffset: 120, endOffset: 123 })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ startOffset: 120, endOffset: 123 })
    expect(created[0]).toMatchObject({ startOffset: 120, endOffset: 123 })
    // offsets come as a pair, end after start
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1', startOffset: 5 })).statusCode).toBe(400)
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1', startOffset: 5, endOffset: 5 })).statusCode).toBe(400)
  })

  it('still saves the link (without its range) before the range columns exist', async () => {
    const { app, created } = await build()
    const prisma = (app as unknown as { prisma: { sourceReference: { create: ReturnType<typeof vi.fn> } } }).prisma
    const real = prisma.sourceReference.create.getMockImplementation()!
    prisma.sourceReference.create.mockImplementationOnce(async () => { throw Object.assign(new Error('column does not exist'), { code: 'P2022' }) })
    prisma.sourceReference.create.mockImplementation(real)
    const res = await post(app, { sectionId: 's1', spanText: 'PFS', uploadId: 'pdf1', startOffset: 1, endOffset: 4 })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ startOffset: null, endOffset: null })
    expect(created[0]).not.toHaveProperty('startOffset')
  })

  it('works when the client knows the range columns but the database does not have them yet', async () => {
    const { app, created } = await build()
    const prisma = (app as unknown as { prisma: { sourceReference: Record<string, ReturnType<typeof vi.fn>> } }).prisma
    // what Prisma throws when it reads/writes a column the database lacks
    const missing = () => Object.assign(new Error('Invalid `prisma.sourceReference.create()` invocation: The column `source_references.startOffset` does not exist in the current database.'), { code: 'P2022' })
    for (const op of ['create', 'findMany', 'findFirst'] as const) {
      const real = prisma.sourceReference[op]!.getMockImplementation()!
      prisma.sourceReference[op]!.mockImplementation(async (args: { select?: unknown }) => { if (!args.select) throw missing(); return real(args) })
    }
    const res = await post(app, { sectionId: 's1', spanText: 'PFS', uploadId: 'pdf1', startOffset: 1, endOffset: 4 })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ startOffset: null, endOffset: null })
    expect(created.at(-1)).not.toHaveProperty('startOffset')
    const list = await app.inject({ method: 'GET', url: '/documents/DOC-1/references' })
    expect(list.statusCode).toBe(200)
    expect(list.json().items[0]).toMatchObject({ id: 'r1', startOffset: null, endOffset: null })
    expect((await app.inject({ method: 'GET', url: '/documents/DOC-1/sources' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/documents/DOC-1/references/r1/remove', payload: {} })).statusCode).toBe(200)
  })

  it('does not allow a source from another project', async () => {
    const { app, created } = await build()
    const res = await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'foreign' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('source_not_in_project')
    expect(created).toHaveLength(0)
  })

  it.each(['bad', 'rej', 'unsaved'])('refuses an unusable source (%s)', async (uploadId) => {
    const { app } = await build()
    const res = await post(app, { sectionId: 's1', spanText: 'x', uploadId })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('source_unusable')
  })

  it('validates the body', async () => {
    const { app } = await build()
    expect((await post(app, { sectionId: 's1', spanText: '   ', uploadId: 'pdf1' })).statusCode).toBe(400)
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1', page: 0 })).statusCode).toBe(400)
    expect((await post(app, { spanText: 'x', uploadId: 'pdf1' })).statusCode).toBe(400)
  })

  it('404s for a missing or deleted document', async () => {
    const { app } = await build()
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1' }, 'NOPE')).statusCode).toBe(404)
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1' }, 'DOC-GONE')).statusCode).toBe(404)
  })

  it('is append-only: there is no update or delete route', async () => {
    const { app } = await build()
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      expect((await app.inject({ method, url: '/documents/DOC-1/references/ref-1' })).statusCode).toBe(404)
    }
  })
})

describe('GET /documents/:id/references', () => {
  it('lists all references with source details, or one section', async () => {
    const { app } = await build()
    const all = (await app.inject({ method: 'GET', url: '/documents/DOC-1/references' })).json()
    expect(all.items.map((i: { id: string }) => i.id)).toEqual(['r1', 'r2'])
    expect(all.items[0]).toMatchObject({ fileName: 'Protocol.pdf', previewable: true, page: 42, createdBy: { name: 'Priya Nair' } })
    expect(all.items[1]).toMatchObject({ fileName: 'SAP.docx', previewable: true })
    const one = (await app.inject({ method: 'GET', url: '/documents/DOC-1/references?sectionId=s2' })).json()
    expect(one.items.map((i: { id: string }) => i.id)).toEqual(['r2'])
  })
})

describe('POST /documents/:id/references/:referenceId/remove', () => {
  const remove = (app: Awaited<ReturnType<typeof build>>['app'], refId: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/documents/DOC-1/references/${refId}/remove`, payload: payload as never })

  it('records the removal, audits it, and drops the link from lists', async () => {
    const { app, removals, audit } = await build()
    const res = await remove(app, 'r1', { reason: 'Wrong source picked' })
    expect(res.statusCode).toBe(200)
    expect(removals).toEqual([expect.objectContaining({ referenceId: 'r1', documentId: 'DOC-1', reason: 'Wrong source picked', removedBy: 'viewer' })])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'source_reference_removed', entityType: 'document', entityId: 'DOC-1', actorId: 'viewer',
      details: expect.objectContaining({ referenceId: 'r1', sectionId: 's1', uploadId: 'pdf1', fileName: 'Protocol.pdf', reason: 'Wrong source picked' }),
    }))
    const list = (await app.inject({ method: 'GET', url: '/documents/DOC-1/references' })).json()
    expect(list.items.map((i: { id: string }) => i.id)).toEqual(['r2'])
    const sources = (await app.inject({ method: 'GET', url: '/documents/DOC-1/sources' })).json()
    expect(sources.items.map((i: { uploadId: string }) => i.uploadId)).toEqual(['docx1'])
  })

  it('refuses a second removal and unknown references', async () => {
    const { app } = await build()
    expect((await remove(app, 'r1')).statusCode).toBe(200)
    const again = await remove(app, 'r1')
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('already_removed')
    expect((await remove(app, 'nope')).statusCode).toBe(404)
  })

  it('explains when the removals table has not been migrated yet, and lists still work', async () => {
    const { app, audit } = await build(undefined, { removalsTable: false })
    const res = await remove(app, 'r1')
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('migration_pending')
    expect(audit).not.toHaveBeenCalled()
    const list = (await app.inject({ method: 'GET', url: '/documents/DOC-1/references' })).json()
    expect(list.items).toHaveLength(2)
  })
})

describe('locked documents', () => {
  it.each(['in_review', 'pending_signature', 'signed'])('refuses to add or remove references while %s', async (docStatus) => {
    const { app, created, removals, audit } = await build(undefined, { docStatus })
    const add = await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1' })
    expect(add.statusCode).toBe(423)
    expect(add.json()).toMatchObject({ error: 'document_locked', status: docStatus })
    const rm = await app.inject({ method: 'POST', url: '/documents/DOC-1/references/r1/remove', payload: {} })
    expect(rm.statusCode).toBe(423)
    expect(created).toHaveLength(0)
    expect(removals).toHaveLength(0)
    expect(audit).not.toHaveBeenCalled()
    // reading still works
    expect((await app.inject({ method: 'GET', url: '/documents/DOC-1/references' })).statusCode).toBe(200)
  })

  it.each(['not_started', 'in_authoring', 'crm_in_progress'])('allows changes while %s', async (docStatus) => {
    const { app } = await build(undefined, { docStatus })
    expect((await post(app, { sectionId: 's1', spanText: 'x', uploadId: 'pdf1' })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: '/documents/DOC-1/references/r1/remove', payload: {} })).statusCode).toBe(200)
  })
})

describe('GET /projects/:id/source-documents/:uploadId/preview', () => {
  it("audits on the document when opened from one of the project's documents", async () => {
    const { app, audit } = await build()
    expect((await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/pdf1/preview?documentId=DOC-1' })).statusCode).toBe(200)
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'source_document_viewed', entityType: 'document', entityId: 'DOC-1', details: expect.objectContaining({ uploadId: 'pdf1' }) }))
    // a document from elsewhere is ignored: the entry stays on the upload
    await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/pdf1/preview?documentId=OTHER' })
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: 'document_upload', entityId: 'pdf1' }))
  })

  it('serves PDFs and images inline with safe headers and audits the view', async () => {
    const { app, audit } = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/pdf1/preview' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toMatch(/^inline;/)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toContain('no-store')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'source_document_viewed', entityId: 'pdf1' }))
    expect((await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/img1/preview' })).statusCode).toBe(200)
  })

  it('refuses legacy Office and script-capable types with 415', async () => {
    const { app, blobGet } = await build()
    for (const id of ['doc1', 'svg1']) {
      const res = await app.inject({ method: 'GET', url: `/projects/proj-1/source-documents/${id}/preview` })
      expect(res.statusCode).toBe(415)
      expect(res.json().error).toBe('not_previewable')
    }
    expect(blobGet).not.toHaveBeenCalled()
  })

  it('shows a CSV as plain text and a DOCX as sandboxed HTML', async () => {
    const csv = await build(vi.fn(async () => ({ body: Buffer.from('a,b\n1,2'), contentType: 'application/vnd.ms-excel' })))
    const c = await csv.app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/csv1/preview' })
    expect(c.statusCode).toBe(200)
    expect(c.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(c.body).toBe('a,b\n1,2')
    expect(c.headers['content-security-policy']).toContain("default-src 'none'")

    const docx = await build(vi.fn(async () => ({ body: Buffer.from('docx-bytes'), contentType: 'application/octet-stream' })))
    const d = await docx.app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/docx1/preview' })
    expect(d.statusCode).toBe(200)
    expect(d.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(d.body).toContain('<p>Hello</p>')
    expect(d.headers['content-security-policy']).toContain('sandbox')

    const bad = await build(vi.fn(async () => ({ body: Buffer.from('corrupt'), contentType: 'application/octet-stream' })))
    const e = await bad.app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/docx1/preview' })
    expect(e.statusCode).toBe(422)
    expect(e.json().error).toBe('preview_failed')
  })

  it('is scoped to the project, blocks quarantined files and reports missing bytes', async () => {
    const { app } = await build()
    expect((await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/foreign/preview' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/bad/preview' })).statusCode).toBe(403)
    const gone = await build(vi.fn(async () => { throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }) }))
    const res = await gone.app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/pdf1/preview' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('file_missing')
  })
})

describe('isPreviewable', () => {
  it('allows PDF, raster images, DOCX and plain-text files only', () => {
    expect(isPreviewable('application/pdf')).toBe(true)
    expect(isPreviewable('IMAGE/PNG; charset=binary')).toBe(true)
    expect(isPreviewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    expect(isPreviewable('text/csv')).toBe(true)
    for (const t of ['image/svg+xml', 'text/html', 'application/vnd.ms-excel', 'application/octet-stream', 'application/msword']) expect(isPreviewable(t)).toBe(false)
    // a generic type is accepted only for a text extension
    expect(isPreviewable('application/vnd.ms-excel', 'TEAE.CSV')).toBe(true)
    expect(isPreviewable('application/octet-stream', 'run.exe')).toBe(false)
  })
})
