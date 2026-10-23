// Source-document library routes, through Fastify inject() with a stubbed
// Prisma + blob store: listing (shape, search, state filter, sort, paging,
// per-project scoping) and the guarded download.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { contentDisposition, documentsSourceRoutes } from './source-routes.js'

type Upload = {
  id: string; projectId: string; uploadedBy: string; blobKey: string; fileName: string
  fileSizeBytes: number; contentType: string; virusScanStatus: string; classification: unknown
  status: string; documentId: string | null; createdAt: Date
  title: string | null; sourceCategory: string | null; origin: string | null; version: string | null
}

const up = (over: Partial<Upload> & Pick<Upload, 'id' | 'fileName'>): Upload => ({
  projectId: 'proj-1', uploadedBy: 'u1', blobKey: `proj-1/pending-uploads/${over.id}`, fileSizeBytes: 1000,
  contentType: 'application/pdf', virusScanStatus: 'passed', classification: { documentType: 'protocol', typeConfidence: 86 },
  status: 'pending_classification', documentId: null, createdAt: new Date('2026-10-20T10:00:00Z'),
  title: null, sourceCategory: null, origin: null, version: null, ...over,
})

const ROWS: Upload[] = [
  up({ id: 'a', fileName: 'Protocol v2.docx', fileSizeBytes: 500, createdAt: new Date('2026-10-18T08:00:00Z'), status: 'confirmed', title: 'Protocol — VELORA-301', sourceCategory: 'protocol', origin: 'Sponsor', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  up({ id: 'b', fileName: 'lab-listing.csv', classification: { documentType: 'protocol', typeConfidence: 60 }, fileSizeBytes: 90, createdAt: new Date('2026-10-19T08:00:00Z'), uploadedBy: 'u2', contentType: 'text/csv' }),
  up({ id: 'c', fileName: 'scan-0042.png', fileSizeBytes: 4000, createdAt: new Date('2026-10-20T08:00:00Z'), status: 'rejected', contentType: 'image/png' }),
  up({ id: 'd', fileName: 'SAP draft.pdf', fileSizeBytes: 2500, createdAt: new Date('2026-10-21T08:00:00Z') }),
  up({ id: 'other', projectId: 'proj-2', fileName: 'someone-elses.pdf' }),
]

async function build(blob: { get: ReturnType<typeof vi.fn> } = { get: vi.fn() }) {
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'proj-1' ? { id: 'proj-1' } : null)) },
    documentUpload: {
      findMany: vi.fn(async ({ where }: { where: { projectId: string } }) => ROWS.filter(r => r.projectId === where.projectId)),
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) => ROWS.find(r => r.id === where.id && r.projectId === where.projectId) ?? null),
    },
    documentSource: { findMany: vi.fn(async () => [{ documentId: 'DOC-9', uploadId: 'a', linkedBy: 'u1', createdAt: new Date() }]) },
    document: { findMany: vi.fn(async () => [{ id: 'DOC-9', title: 'CSR — VELORA-301' }]) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'Priya Nair', email: 'p@x.io' }, { id: 'u2', name: 'Dan Okafor', email: 'd@x.io' }]) },
  } as never)
  app.decorate('blob', blob as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'viewer', email: 'v@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsSourceRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, audit }
}

const list = async (qs = '') => {
  const { app } = await build()
  const res = await app.inject({ method: 'GET', url: `/projects/proj-1/source-documents${qs}` })
  return { res, body: res.json() }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('GET /projects/:id/source-documents', () => {
  it('lists only this project\'s files with derived title, state and uploader name', async () => {
    const { res, body } = await list('?sort=uploaded&dir=asc')
    expect(res.statusCode).toBe(200)
    expect(body.total).toBe(4)
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    const saved = body.items[0]
    expect(saved).toMatchObject({ title: 'Protocol — VELORA-301', state: 'saved', category: 'protocol', categorySource: 'set', origin: 'Sponsor' })
    expect(saved.usedIn).toEqual([{ id: 'DOC-9', title: 'CSR — VELORA-301' }])
    expect(saved.uploadedBy).toMatchObject({ name: 'Priya Nair' })
    // unsaved file falls back to its filename without the extension
    expect(body.items[3]).toMatchObject({ title: 'SAP draft', state: 'pending', usedIn: [] })
  })

  it('categorises unsaved files from the file name and never defaults to a real category', async () => {
    const { body } = await list('?sort=uploaded&dir=asc')
    const byId = Object.fromEntries(body.items.map((i: { id: string }) => [i.id, i]))
    expect(byId.d).toMatchObject({ category: 'sap', categorySource: 'detected' })
    expect(byId.b).toMatchObject({ category: 'lab_data', categorySource: 'detected' })
    expect(byId.c).toMatchObject({ category: 'other', categorySource: 'detected' })
  })

  it('reports project-wide counts that ignore the active filter', async () => {
    const { body } = await list('?state=saved')
    expect(body.total).toBe(1)
    expect(body.summary).toEqual({ files: 4, saved: 1, pending: 2, rejected: 1 })
  })

  it.each([
    ['saved', ['a']], ['pending', ['b', 'd']], ['rejected', ['c']],
  ])('filters by state=%s', async (state, ids) => {
    const { body } = await list(`?state=${state}&sort=file&dir=asc`)
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(ids)
  })

  it('searches title, filename and uploader, case-insensitively', async () => {
    expect((await list('?q=VELORA')).body.items.map((i: { id: string }) => i.id)).toEqual(['a'])   // title / used-in document
    expect((await list('?q=LISTING')).body.items.map((i: { id: string }) => i.id)).toEqual(['b'])  // filename
    expect((await list('?q=okafor')).body.items.map((i: { id: string }) => i.id)).toEqual(['b'])   // uploader
    expect((await list('?q=nothing-matches')).body.total).toBe(0)
  })

  it('sorts by file name and by size in both directions', async () => {
    expect((await list('?sort=file&dir=asc')).body.items.map((i: { id: string }) => i.id)).toEqual(['b', 'a', 'd', 'c'])
    expect((await list('?sort=size&dir=desc')).body.items.map((i: { id: string }) => i.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('defaults to newest first', async () => {
    expect((await list()).body.items.map((i: { id: string }) => i.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('pages without repeating or dropping rows', async () => {
    const p1 = (await list('?pageSize=10')).body
    expect(p1.pageSize).toBe(10)
    expect(p1.items).toHaveLength(4)
    expect((await list('?pageSize=10&page=2')).body.items).toHaveLength(0)
  })

  it('rejects bad query values and unknown projects', async () => {
    expect((await list('?pageSize=7')).res.statusCode).toBe(400)
    expect((await list('?sort=password')).res.statusCode).toBe(400)
    const { app } = await build()
    expect((await app.inject({ method: 'GET', url: '/projects/nope/source-documents' })).statusCode).toBe(404)
  })
})

describe('GET /projects/:id/source-documents/:uploadId/download', () => {
  it('streams the file as an attachment with safe headers and audits the download', async () => {
    const get = vi.fn(async () => ({ body: Buffer.from('%PDF-bytes'), contentType: 'application/pdf' }))
    const { app, audit } = await build({ get })
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/d/download' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('%PDF-bytes')
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('SAP draft.pdf')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toContain('no-store')
    expect(get).toHaveBeenCalledWith('documents', 'proj-1/pending-uploads/d')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'source_document_downloaded', entityId: 'd', actorId: 'viewer' }))
  })

  it('will not serve another project\'s file through this project\'s URL', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/other/download' })
    expect(res.statusCode).toBe(404)
  })

  it('refuses a file that failed the virus scan', async () => {
    ROWS.push(up({ id: 'bad', fileName: 'bad.pdf', virusScanStatus: 'failed' }))
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/bad/download' })
    ROWS.pop()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('quarantined')
  })

  it('returns 404 file_missing when the bytes are gone from storage', async () => {
    const { app, audit } = await build({ get: vi.fn(async () => { throw new Error('NoSuchKey') }) })
    const res = await app.inject({ method: 'GET', url: '/projects/proj-1/source-documents/d/download' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('file_missing')
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('contentDisposition', () => {
  it('encodes non-ASCII and header-breaking characters', () => {
    const h = contentDisposition('Résumé "final";x.pdf')
    // ASCII fallback: accents -> _, quote and semicolon -> _ (so the value can't end early)
    expect(h).toBe(`attachment; filename="R_sum_ _final__x.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%3Bx.pdf`)
  })
})
