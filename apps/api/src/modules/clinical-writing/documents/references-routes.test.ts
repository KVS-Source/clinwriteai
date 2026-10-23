// Reference links (FR-A-022) and the inline source preview, through Fastify inject()
// with a stubbed Prisma + blob store.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsReferencesRoutes } from './references-routes.js'
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
  up({ id: 'bad', fileName: 'bad.pdf', virusScanStatus: 'failed' }),
  up({ id: 'rej', fileName: 'rej.pdf', status: 'rejected' }),
  up({ id: 'unsaved', fileName: 'unsaved.pdf', status: 'pending_classification' }),
  up({ id: 'foreign', projectId: 'proj-2', fileName: 'foreign.pdf' }),
]

async function build(blobGet = vi.fn(async () => ({ body: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' }))) {
  const created: Array<Record<string, unknown>> = []
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1' })) },
    document: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'DOC-1' ? { id: 'DOC-1', projectId: 'proj-1', deletedAt: null } : where.id === 'DOC-GONE' ? { id: 'DOC-GONE', projectId: 'proj-1', deletedAt: new Date() } : null),
      findMany: vi.fn(async () => []),
    },
    documentUpload: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) => UPLOADS.find(u => u.id === where.id && u.projectId === where.projectId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) => UPLOADS.filter(u => where.id?.in.includes(u.id))),
    },
    user: { findMany: vi.fn(async () => [{ id: 'viewer', name: 'Priya Nair', email: 'p@x.io' }]) },
    sourceReference: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: 'ref-1', createdAt: new Date('2026-10-22T09:00:00Z'), ...data }; created.push(row); return row }),
      findMany: vi.fn(async ({ where }: { where: { documentId: string; sectionId?: string } }) =>
        [
          { id: 'r1', documentId: 'DOC-1', sectionId: 's1', spanText: 'PFS was 11.2 months', uploadId: 'pdf1', page: 42, locator: '§9.4', createdBy: 'viewer', createdAt: new Date('2026-10-22T09:00:00Z') },
          { id: 'r2', documentId: 'DOC-1', sectionId: 's2', spanText: 'AE listing', uploadId: 'docx1', page: null, locator: null, createdBy: 'viewer', createdAt: new Date('2026-10-22T09:05:00Z') },
        ].filter(r => r.documentId === where.documentId && (!where.sectionId || r.sectionId === where.sectionId))),
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
  return { app, created, audit, blobGet }
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
    expect(all.items[1]).toMatchObject({ fileName: 'SAP.docx', previewable: false })
    const one = (await app.inject({ method: 'GET', url: '/documents/DOC-1/references?sectionId=s2' })).json()
    expect(one.items.map((i: { id: string }) => i.id)).toEqual(['r2'])
  })
})

describe('GET /projects/:id/source-documents/:uploadId/preview', () => {
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

  it('refuses Word/Excel and script-capable types with 415', async () => {
    const { app, blobGet } = await build()
    for (const id of ['docx1', 'svg1']) {
      const res = await app.inject({ method: 'GET', url: `/projects/proj-1/source-documents/${id}/preview` })
      expect(res.statusCode).toBe(415)
      expect(res.json().error).toBe('not_previewable')
    }
    expect(blobGet).not.toHaveBeenCalled()
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
  it('allows only PDF and raster images', () => {
    expect(isPreviewable('application/pdf')).toBe(true)
    expect(isPreviewable('IMAGE/PNG; charset=binary')).toBe(true)
    for (const t of ['image/svg+xml', 'text/html', 'application/vnd.ms-excel', 'application/octet-stream']) expect(isPreviewable(t)).toBe(false)
  })
})
