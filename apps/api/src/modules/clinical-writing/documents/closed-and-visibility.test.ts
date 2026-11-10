// A closed project refuses changes (423), and a document's reads answer 404 to
// someone who doesn't work on it.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { commentsRoutes } from '../comments/routes.js'
import { documentsRoutes } from './routes.js'
import { documentProjectIsClosed, projectIsClosed } from '../../projects/closed.js'
import { canSeeDocument } from '../../projects/visibility.js'

const prismaFor = (status: string, visibleCount = 1) => ({
  document: {
    findUnique: vi.fn(async () => ({ id: 'DOC-1', projectId: 'proj-1', status: 'in_authoring', assigneeId: 'u1', stage: 'legacy', deletedAt: null })),
    count: vi.fn(async () => visibleCount),
  },
  project: { findUnique: vi.fn(async () => ({ id: 'proj-1', status })) },
  documentRaci: { findFirst: vi.fn(async () => ({ id: 'raci-r' })), findMany: vi.fn(async () => []) },
  comment: { findMany: vi.fn(async () => []), create: vi.fn() },
})

async function build(status: string, visibleCount = 1) {
  const app = Fastify()
  const prisma = prismaFor(status, visibleCount)
  app.decorate('prisma', prisma as never)
  const append = vi.fn(async () => undefined)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, append }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('closed project helpers', () => {
  it('reads the status of the project, or of the document\'s project', async () => {
    const closed = prismaFor('closed') as never
    const ongoing = prismaFor('ongoing') as never
    expect(await projectIsClosed(closed, 'proj-1')).toBe(true)
    expect(await projectIsClosed(ongoing, 'proj-1')).toBe(false)
    expect(await documentProjectIsClosed(closed, 'DOC-1')).toBe(true)
    expect(await documentProjectIsClosed(ongoing, 'DOC-1')).toBe(false)
  })

  it('leaves an unknown document to the route\'s own 404', async () => {
    const prisma = prismaFor('closed')
    prisma.document.findUnique.mockResolvedValueOnce(null as never)
    expect(await documentProjectIsClosed(prisma as never, 'NOPE')).toBe(false)
  })
})

describe('closed project is read-only', () => {
  it.each([
    ['create a version', '/documents/DOC-1/versions', {}],
    ['add a comment', '/documents/DOC-1/comments', { sectionRef: 's1', text: 'x' }],
  ])('refuses to %s with 423 and audits nothing', async (_name, url, payload) => {
    const { app, append } = await build('closed')
    const res = await app.inject({ method: 'POST', url, payload })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'document_locked', status: 'project_closed' })
    expect(append).not.toHaveBeenCalled()
  })

  it('does not refuse the same request on an open project', async () => {
    const { app } = await build('ongoing')
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/comments', payload: {} })
    expect(res.statusCode).not.toBe(423)
  })
})

describe('document-scoped reads respect visibility', () => {
  it.each([
    ['stage', '/documents/DOC-1/stage'],
    ['AI draft status', '/documents/DOC-1/ai-draft-status'],
    ['comments', '/documents/DOC-1/comments'],
  ])('answers 404 for %s when the caller does not work on the document', async (_name, url) => {
    const { app } = await build('ongoing', 0)
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(404)
  })

  it('canSeeDocument follows the scoped count, and for a PM the projects they can see (CW-020)', async () => {
    const base = { id: 'u1', email: 'u@x.io', modules: ['A'], tenantId: null }
    const hidden = prismaFor('ongoing', 0)
    expect(await canSeeDocument(hidden as never, { ...base, role: 'clinical-writer' } as AuthenticatedUser, 'DOC-1')).toBe(false)
    const projectLists = (member: boolean) => ({
      projectMember: { findMany: vi.fn(async () => (member ? [{ projectId: 'proj-1' }] : [])) },
      projectTeamMember: { findMany: vi.fn(async () => []) },
      raciAssignment: { findMany: vi.fn(async () => []) },
    })
    const pm = { ...base, role: 'pm' } as AuthenticatedUser
    const onProject = prismaFor('ongoing', 1)
    expect(await canSeeDocument({ ...onProject, ...projectLists(true), document: { ...onProject.document, findMany: vi.fn(async () => []) } } as never, pm, 'DOC-1')).toBe(true)
    const offProject = prismaFor('ongoing', 1)
    expect(await canSeeDocument({ ...offProject, ...projectLists(false), document: { ...offProject.document, findMany: vi.fn(async () => []) } } as never, pm, 'DOC-1')).toBe(false)
  })
})
