// The version list and a version's sections are for an auditor, a PM, or the document's R or Q.
// Through Fastify inject() with a stubbed Prisma. The full who-may matrix is in
// platform/document-raci/comment-crm-access.test.ts; this checks the routes actually apply it.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'

async function build(letter: string | null) {
  const list = vi.fn(async () => [{ id: 'v1', versionNumber: 'v0.1' }])
  const one = vi.fn(async () => ({ id: 'v1', versionNumber: 'v0.1', sections: [] }))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: DOC, projectId: 'p-1', assigneeId: 'someone-else' })) },
    documentRaci: {
      findMany: vi.fn(async ({ where }: { where: { letter: { in: string[] } } }) =>
        (letter && where.letter.in.includes(letter) ? [{ documentId: DOC }] : [])),
    },
    documentVersion: { findMany: list, findFirst: one },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-1', email: 'u@x', role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, list, one }
}

describe('document versions', () => {
  it.each(['C', 'A', 'I', null])('are refused to %s, without reading any version', async (letter) => {
    const { app, list, one } = await build(letter)
    for (const url of [`/documents/${DOC}/versions`, `/documents/${DOC}/versions/v1/sections`]) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error).toBe('version_view_forbidden')
    }
    expect(list).not.toHaveBeenCalled()
    expect(one).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/versions/access` })).json()).toEqual({ canView: false })
    await app.close()
  })

  it.each(['R', 'Q'])('are open to %s', async (letter) => {
    const { app } = await build(letter)
    for (const url of [`/documents/${DOC}/versions`, `/documents/${DOC}/versions/v1/sections`]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200)
    }
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/versions/access` })).json()).toEqual({ canView: true })
    await app.close()
  })
})
