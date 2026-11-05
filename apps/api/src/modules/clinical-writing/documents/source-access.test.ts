// Who may do what with source documents. Authors link, edit and delete. R, C, Q, A, PMs and
// auditors view. Admins, Informed and guests get nothing. For now a PM may also upload, and
// finish or cancel their own upload. Through Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsReferencesRoutes } from './references-routes.js'
import { documentsSourceRoutes } from './source-routes.js'
import { documentsUploadRoutes } from './upload-routes.js'

const P = 'proj-1'
const DOC = 'DOC-1'
const ME = 'u-me'

type Who = {
  role?: AuthenticatedUser['role']
  letters?: string[]
  assignee?: boolean
  memberOfProject?: boolean
  uploadStatus?: string
  uploadedBy?: string
}

async function build(who: Who = {}) {
  const letters = who.letters ?? []
  const upload = {
    id: 'up-1', projectId: P, uploadedBy: who.uploadedBy ?? 'someone-else', blobKey: 'k', fileName: 'Protocol.pdf', fileSizeBytes: 3,
    contentType: 'application/pdf', virusScanStatus: 'passed', classification: null, status: who.uploadStatus ?? 'confirmed',
    documentId: null, title: 'Protocol', sourceCategory: 'protocol', origin: null, version: null, createdAt: new Date('2026-10-20T10:00:00Z'),
  }
  const writes = { update: vi.fn(async () => upload), delete: vi.fn(async () => upload), create: vi.fn(async () => upload) }
  const blob = { get: vi.fn(async () => ({ body: Buffer.from('pdf'), contentType: 'application/pdf' })), del: vi.fn(async () => undefined), put: vi.fn(async () => undefined) }
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: P, status: 'ongoing', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    document: {

      count: async () => 1,
      findUnique: vi.fn(async () => ({ id: DOC, projectId: P, status: 'in_authoring', deletedAt: null, assigneeId: who.assignee ? ME : 'other', currentVersion: { sections: [] } })),
      findFirst: vi.fn(async () => (who.assignee ? { id: DOC } : null)),
      findMany: vi.fn(async () => []),
    },
    documentRaci: {
      findFirst: vi.fn(async ({ where }: { where: { letter?: string | { in: string[] } } }) => {
        const asked = typeof where.letter === 'string' ? [where.letter] : where.letter?.in ?? []
        return asked.some(l => letters.includes(l)) ? { id: 'raci-1' } : null
      }),
      findMany: vi.fn(async () => []),
    },
    documentUpload: {
      findFirst: vi.fn(async () => upload),
      findMany: vi.fn(async () => [upload]),
      ...writes,
    },
    documentSource: { findMany: vi.fn(async () => []) },
    sourceReference: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'ref-1' })) },
    sourceReferenceRemoval: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    projectMember: { findMany: vi.fn(async () => (who.memberOfProject === false ? [] : [{ projectId: P }])) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('blob', blob as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: ME, email: 'u@x', role: who.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsSourceRoutes, { prefix: '/projects' })
  await app.register(documentsUploadRoutes, { prefix: '/projects' })
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, writes }
}

const VIEW_ROUTES = [
  { name: 'list the library', url: `/projects/${P}/source-documents` },
  { name: 'download a file',  url: `/projects/${P}/source-documents/up-1/download` },
  { name: 'open a file',      url: `/projects/${P}/source-documents/up-1/preview` },
  { name: "list a document's sources", url: `/documents/${DOC}/sources` },
  { name: "list a document's references", url: `/documents/${DOC}/references` },
]

const CAN_VIEW: Array<[string, Who]> = [
  ['an author (R)', { letters: ['R'] }],
  ['the assignee', { assignee: true }],
  ['a reviewer (C)', { letters: ['C'] }],
  ['QC (Q)', { letters: ['Q'] }],
  ['an approver (A)', { letters: ['A'] }],
  ['a PM on the project', { role: 'pm' }],
  ['an auditor', { role: 'auditor' }],
  ['someone both Informed and a reviewer', { letters: ['I', 'C'] }],
]
const CANNOT_VIEW: Array<[string, Who]> = [
  ['Informed (I)', { letters: ['I'] }],
  ['a project member holding no letter', {}],
  ['a tenant admin', { role: 'tenant-admin' }],
  ['a tenant admin holding R', { role: 'tenant-admin', letters: ['R'] }],
  ['a guest', { role: 'guest' }],
  ['a guest holding C', { role: 'guest', letters: ['C'] }],
  ['a PM on another project', { role: 'pm', memberOfProject: false }],
]

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('viewing source documents', () => {
  describe.each(CAN_VIEW)('%s', (_label, who) => {
    it.each(VIEW_ROUTES)('can $name', async ({ url }) => {
      const { app } = await build(who)
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
      await app.close()
    })
  })

  describe.each(CANNOT_VIEW)('%s', (_label, who) => {
    it.each(VIEW_ROUTES)('cannot $name', async ({ url }) => {
      const { app } = await build(who)
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('source_view_forbidden')
      await app.close()
    })
  })
})

describe('GET source-documents/access', () => {
  it.each<[string, Who, { canView: boolean; canUpload: boolean }]>([
    ['an author', { letters: ['R'] }, { canView: true, canUpload: true }],
    ['the assignee', { assignee: true }, { canView: true, canUpload: true }],
    ['a PM on the project', { role: 'pm' }, { canView: true, canUpload: true }],
    ['a PM on another project', { role: 'pm', memberOfProject: false }, { canView: false, canUpload: false }],
    ['a reviewer', { letters: ['C'] }, { canView: true, canUpload: false }],
    ['QC', { letters: ['Q'] }, { canView: true, canUpload: false }],
    ['an approver', { letters: ['A'] }, { canView: true, canUpload: false }],
    ['an auditor', { role: 'auditor' }, { canView: true, canUpload: false }],
    ['Informed', { letters: ['I'] }, { canView: false, canUpload: false }],
    ['a tenant admin holding R', { role: 'tenant-admin', letters: ['R'] }, { canView: false, canUpload: false }],
    ['a guest holding R', { role: 'guest', letters: ['R'] }, { canView: false, canUpload: false }],
  ])('%s', async (_label, who, expected) => {
    const { app } = await build(who)
    expect((await app.inject({ method: 'GET', url: `/projects/${P}/source-documents/access` })).json()).toEqual(expected)
    await app.close()
  })
})

describe('uploading', () => {
  const upload = (app: Awaited<ReturnType<typeof build>>['app']) =>
    app.inject({ method: 'POST', url: `/projects/${P}/documents/upload` })

  it.each<[string, Who]>([
    ['a reviewer', { letters: ['C'] }], ['QC', { letters: ['Q'] }], ['an approver', { letters: ['A'] }], ['Informed', { letters: ['I'] }],
    ['a tenant admin', { role: 'tenant-admin', letters: ['R'] }], ['a guest', { role: 'guest', letters: ['R'] }],
    ['a PM on another project', { role: 'pm', memberOfProject: false }],
  ])('%s is refused', async (_label, who) => {
    const { app, writes } = await build(who)
    const res = await upload(app)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('source_edit_forbidden')
    expect(writes.create).not.toHaveBeenCalled()
    await app.close()
  })

  it.each<[string, Who]>([['an author', { letters: ['R'] }], ['a PM on the project', { role: 'pm' }]])('%s gets past the check', async (_label, who) => {
    const { app } = await build(who)
    expect((await upload(app)).json().error).not.toBe('source_edit_forbidden')
    await app.close()
  })
})

describe('saving (editing) and deleting a source', () => {
  const save = (app: Awaited<ReturnType<typeof build>>['app']) =>
    app.inject({ method: 'POST', url: `/projects/${P}/source-documents/up-1/save`, payload: { title: 'New title', category: 'protocol' } })
  const discard = (app: Awaited<ReturnType<typeof build>>['app']) =>
    app.inject({ method: 'DELETE', url: `/projects/${P}/source-documents/up-1` })

  it('an author can edit a saved source and discard an unsaved upload', async () => {
    const saved = await build({ letters: ['R'] })
    expect((await save(saved.app)).statusCode).toBe(200)
    expect(saved.writes.update).toHaveBeenCalled()
    await saved.app.close()
    const pending = await build({ letters: ['R'], uploadStatus: 'pending_classification' })
    expect((await discard(pending.app)).statusCode).toBe(204)
    await pending.app.close()
  })

  it('a PM can finish or cancel their own upload', async () => {
    const mine = { role: 'pm' as const, uploadStatus: 'pending_classification', uploadedBy: ME }
    const a = await build(mine)
    expect((await save(a.app)).statusCode).toBe(200)
    await a.app.close()
    const b = await build(mine)
    expect((await discard(b.app)).statusCode).toBe(204)
    await b.app.close()
  })

  it.each<[string, Who]>([
    ['a PM on a source already saved, even their own', { role: 'pm', uploadedBy: ME }],
    ["a PM on someone else's upload", { role: 'pm', uploadStatus: 'pending_classification' }],
    ['a reviewer', { letters: ['C'], uploadStatus: 'pending_classification', uploadedBy: ME }],
    ['QC', { letters: ['Q'] }],
    ['an approver', { letters: ['A'] }],
    ['Informed', { letters: ['I'] }],
    ['a tenant admin', { role: 'tenant-admin', letters: ['R'] }],
    ['a guest', { role: 'guest', letters: ['R'] }],
  ])('%s is refused both', async (_label, who) => {
    for (const act of [save, discard]) {
      const { app, writes } = await build(who)
      const res = await act(app)
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('source_edit_forbidden')
      expect(writes.update).not.toHaveBeenCalled()
      expect(writes.delete).not.toHaveBeenCalled()
      await app.close()
    }
  })
})

describe('linking a source to document text is for authors only', () => {
  const link = (app: Awaited<ReturnType<typeof build>>['app']) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/references`, payload: { sectionId: 's1', spanText: 'text', uploadId: 'up-1' } })

  it.each<[string, Who]>([
    ['a PM', { role: 'pm' }], ['a reviewer', { letters: ['C'] }], ['QC', { letters: ['Q'] }], ['an approver', { letters: ['A'] }],
    ['Informed', { letters: ['I'] }], ['a tenant admin', { role: 'tenant-admin', letters: ['R'] }],
  ])('%s is refused', async (_label, who) => {
    const { app } = await build(who)
    expect((await link(app)).statusCode).toBe(403)
    await app.close()
  })

  it('an author gets past the check', async () => {
    const { app } = await build({ letters: ['R'] })
    expect((await link(app)).statusCode).not.toBe(403)
    await app.close()
  })
})
