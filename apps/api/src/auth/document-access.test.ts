// CW-020 — the app-wide document visibility hook. A route with a :documentId parameter
// answers 404 to anyone who may not see that document, whether or not the route
// itself remembers to check.

import Fastify from 'fastify'
import fp from 'fastify-plugin'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from './rbac.js'
import documentAccess from './document-access.js'

const DOCS = [
  { id: 'DOC-IN', projectId: 'P-IN', assigneeId: 'writer', raci: ['reviewer'] },
  { id: 'DOC-OUT', projectId: 'P-OUT', assigneeId: 'someone', raci: [] as string[] },
]

const USERS: Record<string, AuthenticatedUser> = {
  admin:    { id: 'admin', email: 'a@x', role: 'tenant-admin', modules: ['A'], tenantId: 't' },
  auditor:  { id: 'auditor', email: 'au@x', role: 'auditor', modules: ['A'], tenantId: 't' },
  pm:       { id: 'pm', email: 'pm@x', role: 'pm', modules: ['A'], tenantId: 't' },
  writer:   { id: 'writer', email: 'w@x', role: 'contributor', modules: ['A'], tenantId: 't' },
  reviewer: { id: 'reviewer', email: 'r@x', role: 'contributor', modules: ['A'], tenantId: 't' },
  outsider: { id: 'outsider', email: 'o@x', role: 'contributor', modules: ['A'], tenantId: 't' },
}

type Where = Record<string, unknown> & { id?: string; projectId?: { in: string[] }; OR?: Array<Record<string, unknown>> }

// Only the PM is a member of P-IN; contributors reach documents through assignee / RACI.
function fakePrisma() {
  const matches = (d: typeof DOCS[number], userId: string) => d.assigneeId === userId || d.raci.includes(userId)
  return {
    projectMember: { findMany: vi.fn(async ({ where }: { where: { userId: string } }) => (where.userId === 'pm' ? [{ projectId: 'P-IN' }] : [])) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    raciAssignment: { findMany: vi.fn(async () => []) },
    document: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async ({ where }: { where: Where }) => DOCS.filter(d => {
        if (where.id && d.id !== where.id) return false
        if (where.projectId && !where.projectId.in.includes(d.projectId)) return false
        if (where.OR) {
          const userId = (where.OR[0] as { assigneeId: string }).assigneeId
          if (!matches(d, userId)) return false
        }
        return true
      }).length),
    },
  }
}

async function build() {
  const app = Fastify()
  const handler = vi.fn(async () => ({ ok: true }))
  await app.register(fp(async (a) => {
    a.decorate('prisma', fakePrisma() as never)
    a.decorateRequest('user', null)
    a.addHook('onRequest', async (req) => { const id = req.headers['x-user'] as string | undefined; if (id) req.user = USERS[id] })
  }))
  await app.register(documentAccess)
  // Routes as the real modules declare them, with no check of their own.
  app.get('/documents/:documentId/versions', handler)
  app.post('/documents/:documentId/checklist', handler)
  app.get('/documents/:documentId/sections/:sectionId/ai-history', handler)
  app.get('/projects/:projectId/documents', handler)
  return { app, handler }
}

const call = async (user: string | null, method: 'GET' | 'POST', url: string) => {
  const { app, handler } = await build()
  const res = await app.inject({ method, url, headers: user ? { 'x-user': user } : {} })
  return { status: res.statusCode, ran: handler.mock.calls.length > 0 }
}

describe('document access hook (CW-020)', () => {
  it.each([
    ['tenant admin', 'admin'], ['auditor', 'auditor'],
  ])('lets a %s open any document', async (_n, user) => {
    expect(await call(user, 'GET', '/documents/DOC-OUT/versions')).toEqual({ status: 200, ran: true })
  })

  it('lets a PM open documents of a project they are on, and 404s documents of other projects', async () => {
    expect(await call('pm', 'GET', '/documents/DOC-IN/versions')).toEqual({ status: 200, ran: true })
    expect(await call('pm', 'GET', '/documents/DOC-OUT/versions')).toEqual({ status: 404, ran: false })
  })

  it('lets a contributor open a document they work on (assignee or RACI), and 404s the rest', async () => {
    expect(await call('writer', 'GET', '/documents/DOC-IN/versions')).toEqual({ status: 200, ran: true })
    expect(await call('reviewer', 'GET', '/documents/DOC-IN/sections/S1/ai-history')).toEqual({ status: 200, ran: true })
    expect(await call('reviewer', 'GET', '/documents/DOC-OUT/versions')).toEqual({ status: 404, ran: false })
  })

  it('stops writes as well as reads, before the route runs', async () => {
    expect(await call('outsider', 'POST', '/documents/DOC-IN/checklist')).toEqual({ status: 404, ran: false })
  })

  it('leaves routes without a :documentId, and unauthenticated calls, to the route', async () => {
    expect(await call('outsider', 'GET', '/projects/P-IN/documents')).toEqual({ status: 200, ran: true })
    expect(await call(null, 'GET', '/documents/DOC-IN/versions')).toEqual({ status: 200, ran: true })
  })
})
