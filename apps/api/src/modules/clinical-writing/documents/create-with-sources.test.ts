// POST /projects/:id/documents with `sourceUploadIds` — the document ↔ source link
// (document_sources). Through Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

const upload = (id: string, over: Record<string, unknown> = {}) => ({
  id, projectId: 'proj-1', status: 'confirmed', virusScanStatus: 'passed', ...over,
})
const UPLOADS = [
  upload('ok1'),
  upload('ok2'),
  upload('pending', { status: 'pending_classification' }),
  upload('rejected', { status: 'rejected' }),
  upload('infected', { virusScanStatus: 'failed' }),
  upload('foreign', { projectId: 'proj-2' }),
]

async function build() {
  const links: Array<Record<string, unknown>> = []
  const documentsCreated: unknown[] = []
  const audit = vi.fn(async () => undefined)

  const tx = {
    document: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { documentsCreated.push(data); return { id: 'DOC-NEW', ...data } }),
      update: vi.fn(async () => ({})),
    },
    documentVersion: { create: vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })) },
    sectionContent: { createMany: vi.fn(async () => ({ count: 0 })) },
    // DocumentService.create now materialises the ChecklistInstance up front
    // (used to be lazy on first GET), so the tx stub needs to model the
    // checklist tables ensureChecklistInstance walks: lookup → auto-create
    // the fallback empty template → create the instance.
    checklistInstance: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'inst-1', items: [] })),
    },
    checklistTemplate: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'tmpl-1', version: 1 })),
    },
  }
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    documentUpload: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; projectId: string } }) =>
        UPLOADS.filter(u => where.id.in.includes(u.id) && u.projectId === where.projectId)),
    },
    documentSource: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { links.push(...data); return { count: data.length } }),
    },
    documentRaci: {
      findFirst: vi.fn(async () => null),
      create:    vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'raci-1', ...data })),
    },
    // The create route checks the DocumentTemplate table for a DB-backed
    // section skeleton before falling back to templateSections(). These
    // tests don't exercise the DB path — return null and let the fallback
    // produce the same sections the pre-M2 code produced.
    documentTemplate: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'writer-1', email: 'w@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()

  const post = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/projects/proj-1/documents', payload: { type: 'csr_full', title: 'CSR', assigneeId: 'u1', ...body } })
  return { post, links, documentsCreated, audit }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('POST /projects/:id/documents — sourceUploadIds', () => {
  it('links every selected source to the new document and audits it', async () => {
    const { post, links, audit } = await build()
    const res = await post({ sourceUploadIds: ['ok1', 'ok2'] })
    expect(res.statusCode).toBe(201)
    expect(links).toEqual([
      { documentId: 'DOC-NEW', uploadId: 'ok1', linkedBy: 'writer-1' },
      { documentId: 'DOC-NEW', uploadId: 'ok2', linkedBy: 'writer-1' },
    ])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document_created',
      details: expect.objectContaining({ sourceUploadIds: ['ok1', 'ok2'] }),
    }))
  })

  it('de-duplicates repeated source ids', async () => {
    const { post, links } = await build()
    expect((await post({ sourceUploadIds: ['ok1', 'ok1'] })).statusCode).toBe(201)
    expect(links.map(l => l.uploadId)).toEqual(['ok1'])
  })

  it('creates a document without sources when none are given', async () => {
    const { post, links } = await build()
    expect((await post({})).statusCode).toBe(201)
    expect(links).toEqual([])
  })

  it.each([
    ['not saved to the library', 'pending'],
    ['rejected', 'rejected'],
    ['failed the virus scan', 'infected'],
    ['in another project', 'foreign'],
    ['unknown', 'does-not-exist'],
  ])('rejects a source that is %s with 422 and creates nothing', async (_label, id) => {
    const { post, links, documentsCreated } = await build()
    const res = await post({ sourceUploadIds: ['ok1', id] })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'source_unusable', uploadId: id })
    expect(documentsCreated).toHaveLength(0)
    expect(links).toEqual([])
  })
})
