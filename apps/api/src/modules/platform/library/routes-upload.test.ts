// POST /library/upload — a Project Manager adds a PDF or Word document from their computer to the Master
// Library, against one of their projects. Fastify inject() over a fake Prisma and blob store; nothing is stored.

import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'

const state = vi.hoisted(() => ({ visible: 'all' as 'all' | Set<string>, text: 'Study report text.', ok: true }))
vi.mock('../../projects/visibility.js', () => ({
  visibleProjectIdsForUser: vi.fn(async () => state.visible),
  visibleDocumentIds: vi.fn(async (_p: unknown, _u: unknown, ids: string[]) => new Set(ids)),
}))
vi.mock('../../clinical-writing/documents/extract-text.js', () => ({
  extractTextFromBlob: vi.fn(async () => ({ ok: state.ok, text: state.text, reason: '', bytes: 10, returned: state.text.length })),
}))

import { libraryRoutes } from './routes.js'

const PDF = Buffer.from('%PDF-1.4 fake pdf bytes')
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface Setup { role?: Role; projectStatus?: string; project?: null; ta?: string | null; prior?: Record<string, unknown> | null }

async function setup(s: Setup = {}) {
  const created: Array<Record<string, unknown>> = []
  const updated: Array<{ where: { id: string }; data: Record<string, unknown> }> = []
  const row = (data: Record<string, unknown>) => ({
    id: 'new-1', tenantId: 't1', title: 'T', body: '', taTag: 'Oncology', framework: 'CSR', category: 'claim', version: 1, isCurrent: true,
    approvedBy: 'u1', approvedAt: new Date('2026-11-13T00:00:00Z'), retiredAt: null, tags: [], updatedAt: new Date('2026-11-13T00:00:00Z'), supersededBy: null, usageCount: 0, ...data,
  })
  const librarySection = {
    findFirst: vi.fn(async () => s.prior ?? null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return row(data) }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => { updated.push(args); return row({}) }),
    findUnique: vi.fn(async () => null),
  }
  const blobPut = vi.fn(async () => undefined)
  const blobGet = vi.fn(async () => ({ body: PDF, contentType: 'application/pdf' }))
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    librarySection,
    project: { findUnique: vi.fn(async () => (s.project === null ? null : { id: 'p1', tenantId: 't1', name: 'Alpha', status: s.projectStatus ?? 'ongoing' })), findMany: vi.fn(async () => [{ id: 'p1', name: 'Alpha', status: s.projectStatus ?? 'ongoing' }]) },
    therapeuticArea: { findFirst: vi.fn(async () => (s.ta === null ? null : { label: s.ta ?? 'Oncology' })) },
    document: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'Alex PM' }]) },
    libraryAdoptionRecord: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ librarySection, $executeRaw: vi.fn(async () => 0) })),
  } as never)
  app.decorate('audit', { append } as never)
  app.decorate('blob', { put: blobPut, get: blobGet } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: AuthenticatedUser }).user = { id: 'u1', email: 'pm@x.io', role: s.role ?? 'pm', modules: ['A'], tenantId: 't1' }
  })
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } })
  await app.register(libraryRoutes, { prefix: '/library' })
  await app.ready()
  current = app
  return { app, created, updated, blobPut, blobGet, append }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null; state.visible = 'all'; state.text = 'Study report text.'; state.ok = true })

// The fields go first, then the file (the route reads the fields from the file part).
async function upload(app: FastifyInstance, over: { fields?: Record<string, string | undefined>; name?: string; type?: string; bytes?: Buffer } = {}) {
  const fd = new FormData()
  const fields = { title: 'CSR Study 1', docType: 'CSR', taTag: 'Oncology', projectId: 'p1', ...over.fields }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v)
  fd.append('file', new Blob([over.bytes ?? PDF], { type: over.type ?? 'application/pdf' }), over.name ?? 'report.pdf')
  const res = new Response(fd)
  return app.inject({ method: 'POST', url: '/library/upload', headers: { 'content-type': res.headers.get('content-type')! }, payload: Buffer.from(await res.arrayBuffer()) })
}

describe('POST /library/upload', () => {
  it('a PM uploads a PDF: text read, original kept, tagged like a pushed document, audited', async () => {
    const t = await setup()
    const res = await upload(t.app)
    expect(res.statusCode).toBe(201)
    expect(t.blobPut).toHaveBeenCalledOnce()
    expect(t.created[0]).toMatchObject({ tenantId: 't1', title: 'CSR Study 1', taTag: 'Oncology', framework: 'CSR', body: 'Study report text.', version: 1, approvedBy: 'u1' })
    const tags = t.created[0]!.tags as string[]
    expect(tags).toEqual(expect.arrayContaining(['module:A', 'doctype:CSR', 'project:p1', 'type:document', 'origin:upload', 'filename:report.pdf']))
    expect(tags.some(x => x.startsWith('file:library/t1/') && x.endsWith('.pdf'))).toBe(true)
    expect(res.json()).toMatchObject({ itemType: 'document', docType: 'CSR', uploaded: true, projectName: 'Alpha', pushedByName: 'Alex PM' })
    expect(res.json().tags).toEqual([])                       // the internal file tags never reach the screen
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'library_uploaded', details: expect.objectContaining({ projectId: 'p1', fileName: 'report.pdf' }) }))
  })

  it('accepts a Word file, and the title defaults to the file name', async () => {
    const t = await setup()
    const res = await upload(t.app, { name: 'Protocol v2.docx', type: DOCX_MIME, fields: { title: undefined } })
    expect(res.statusCode).toBe(201)
    expect(t.created[0]).toMatchObject({ title: 'Protocol v2' })
  })

  it('a later upload with the same title in the same project is the next version and supersedes the earlier one', async () => {
    const t = await setup({ prior: { id: 'old-1', version: 2 } })
    const res = await upload(t.app)
    expect(res.statusCode).toBe(201)
    expect(t.created[0]).toMatchObject({ version: 3 })
    expect(t.updated).toEqual([{ where: { id: 'old-1' }, data: { isCurrent: false, supersededBy: 'new-1' } }])
  })

  it.each(['tenant-admin', 'contributor', 'auditor'] as Role[])('only a Project Manager can upload: %s gets 403 and nothing is stored', async (role) => {
    const t = await setup({ role })
    const res = await upload(t.app)
    expect(res.statusCode).toBe(403)
    expect(t.blobPut).not.toHaveBeenCalled()
    expect(t.created).toHaveLength(0)
  })

  it('refuses any file that is not a PDF or Word document', async () => {
    const t = await setup()
    for (const [name, type] of [['data.xlsx', 'application/vnd.ms-excel'], ['notes.txt', 'text/plain'], ['photo.png', 'image/png'], ['fake.pdf', 'text/html']] as const) {
      const res = await upload(t.app, { name, type })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('unsupported_file')
    }
    expect(t.blobPut).not.toHaveBeenCalled()
  })

  it('needs the document type, therapeutic area and project', async () => {
    const t = await setup()
    for (const missing of ['docType', 'taTag', 'projectId']) {
      const res = await upload(t.app, { fields: { [missing]: undefined } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('validation')
    }
    expect(t.created).toHaveLength(0)
  })

  it("a project the PM can't see, a closed project and an unknown therapeutic area are refused", async () => {
    state.visible = new Set(['other'])
    const hidden = await setup()
    expect((await upload(hidden.app)).statusCode).toBe(404)
    await current?.close(); state.visible = 'all'

    const closed = await setup({ projectStatus: 'closed' })
    expect((await upload(closed.app)).statusCode).toBe(423)
    await current?.close()

    const badTa = await setup({ ta: null })
    expect((await upload(badTa.app)).statusCode).toBe(400)
    expect(badTa.blobPut).not.toHaveBeenCalled()
  })

  it('a file with no readable text (a scanned PDF) is refused before anything is stored', async () => {
    state.text = ''
    const t = await setup()
    const res = await upload(t.app)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('no_text')
    expect(t.blobPut).not.toHaveBeenCalled()
    expect(t.created).toHaveLength(0)
  })
})

describe('Download PDF of an uploaded document', () => {
  it('gives back the original PDF; a Word upload (or a missing file) is rebuilt from its text', async () => {
    const stored = { id: 'u-1', tenantId: 't1', title: 'CSR Study 1', body: 'Study report text.', taTag: 'Oncology', framework: 'CSR', category: 'claim', version: 1, isCurrent: true, approvedBy: 'u1', approvedAt: new Date(), retiredAt: null, updatedAt: new Date(), supersededBy: null, usageCount: 0,
      tags: ['module:A', 'type:document', 'origin:upload', 'file:library/t1/2026-11-13/abc.pdf', 'filename:Final Report.pdf'] }
    const t = await setup()
    ;(t.app as unknown as { prisma: { librarySection: { findFirst: unknown } } }).prisma.librarySection.findFirst = vi.fn(async () => stored)
    const res = await t.app.inject({ method: 'GET', url: '/library/u-1/pdf' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.rawPayload.equals(PDF)).toBe(true)
    expect(res.headers['content-disposition']).toContain('Final%20Report.pdf')
    expect(t.blobGet).toHaveBeenCalledWith('documents', 'library/t1/2026-11-13/abc.pdf')
  })
})
