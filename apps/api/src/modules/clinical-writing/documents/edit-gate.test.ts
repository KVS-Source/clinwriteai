// Only a document's authors may change it. Through Fastify inject() with a stubbed
// Prisma that has no write methods — a refusal has to happen before any write.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'
import { documentsReferencesRoutes } from './references-routes.js'
import { sectionLockRoutes } from '../section-locks/routes.js'
import { ichE3Routes } from '../ich-e3/routes.js'
import { voiceNotesRoutes } from '../voice-notes/routes.js'
import { actorCanEditDocumentContent } from '../../platform/document-raci/access.js'

const DOC = 'DOC-1'
const ROUTES: Array<{ name: string; method: 'POST' | 'PATCH'; url: string; payload?: Record<string, unknown> }> = [
  { name: 'save a section',         method: 'PATCH', url: `/documents/${DOC}/sections/s1`, payload: { contentHtml: '<p>x</p>' } },
  { name: 'restore sections',       method: 'POST',  url: `/documents/${DOC}/restore`, payload: { sections: [{ sectionId: 's1', fromVersionId: 'v1' }], reason: 'because' } },
  { name: 'submit for review',      method: 'POST',  url: `/documents/${DOC}/submit-for-review`, payload: {} },
  { name: 'create a version',       method: 'POST',  url: `/documents/${DOC}/versions`, payload: {} },
  { name: 'AI suggest',             method: 'POST',  url: `/documents/${DOC}/sections/s1/ai-suggest`, payload: { intent: 'edit', customPrompt: 'shorter' } },
  { name: 'take a section lock',    method: 'POST',  url: `/documents/${DOC}/sections/s1/lock`, payload: {} },
  { name: 'mark a section complete', method: 'PATCH', url: `/documents/${DOC}/sections/s1/ich-status`, payload: { status: 'complete' } },
  { name: 'upload a voice note',    method: 'POST',  url: `/documents/${DOC}/voice-notes?sectionRef=s1` },
  { name: 'revert an edit',         method: 'POST',  url: '/documents/section-edits/edit-1/revert', payload: {} },
  { name: 'undo an AI call',        method: 'POST',  url: '/documents/ai-calls/call-1/undo', payload: {} },
  { name: 'accept an AI message',   method: 'POST',  url: '/documents/ai-chat-messages/msg-1/accept', payload: {} },
  { name: 'add a reference',        method: 'POST',  url: `/documents/${DOC}/references`, payload: { sectionId: 's1', spanText: 'text', uploadId: 'up-1' } },
  { name: 'remove a reference',     method: 'POST',  url: `/documents/${DOC}/references/ref-1/remove`, payload: {} },
]

async function build(actor: Partial<AuthenticatedUser>, opts: { rRow?: boolean; assignee?: string } = {}) {
  const app = Fastify()
  const userId = actor.id ?? 'u-1'
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: DOC, projectId: 'p-1', type: 'csr_full', status: 'in_authoring', stage: 'study-start-up',
        deletedAt: null, assigneeId: opts.assignee ?? 'someone-else',
        currentVersion: { sections: [] },
      })),
    },
    documentRaci: { findFirst: vi.fn(async () => (opts.rRow ? { id: 'raci-r' } : null)) },
    editHistory: { findUnique: vi.fn(async () => ({ documentId: DOC })) },
    aiCallRecord: { findUnique: vi.fn(async () => ({ id: 'call-1', documentId: DOC, sectionId: 's1', preCallSectionHtml: '<p>a</p>', undoneAt: null })) },
    aiConversationMessage: { findUnique: vi.fn(async () => ({ id: 'msg-1', documentId: DOC, actorId: userId, role: 'assistant' })) },
    project: { findUnique: vi.fn(async () => ({ id: 'p-1', status: 'initiated' })) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: userId, email: 'u@x', role: 'contributor', modules: ['A'], tenantId: null, ...actor }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })
  await app.register(sectionLockRoutes, { prefix: '/documents' })
  await app.register(ichE3Routes, { prefix: '/documents' })
  await app.register(voiceNotesRoutes, { prefix: '/documents' })
  await app.ready()
  return app
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('editing a document is for its authors only', () => {
  describe.each([
    ['a PM', { role: 'pm' as const }],
    ['a tenant admin', { role: 'tenant-admin' as const }],
    ['a contributor who is not an author', { role: 'contributor' as const }],
  ])('%s', (_label, actor) => {
    it.each(ROUTES)('cannot $name', async ({ method, url, payload }) => {
      const app = await build(actor)
      const res = await app.inject({ method, url, payload })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('document_edit_forbidden')
      await app.close()
    })
  })

  it.each(['pm', 'tenant-admin'] as const)('%s cannot edit even as the assignee holding an R row', async (role) => {
    const app = await build({ role }, { rRow: true, assignee: 'u-1' })
    const res = await app.inject({ method: 'PATCH', url: `/documents/${DOC}/sections/s1`, payload: { contentHtml: '<p>x</p>' } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('actorCanEditDocumentContent', () => {
  const prisma = (rRow: boolean, assigneeId = 'someone-else') => ({
    document:     { findUnique: async () => ({ assigneeId }) },
    documentRaci: { findFirst:  async () => (rRow ? { id: 'raci-r' } : null) },
  }) as never
  const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
    ({ id: 'u-1', email: 'u@x', role: 'contributor', modules: ['A'], tenantId: null, ...over })

  it('allows an author with an active R row', async () => {
    expect(await actorCanEditDocumentContent(prisma(true), user(), DOC)).toBe(true)
  })

  it('allows the assignee, who is the first author', async () => {
    expect(await actorCanEditDocumentContent(prisma(false, 'u-1'), user(), DOC)).toBe(true)
  })

  it('refuses everyone else', async () => {
    expect(await actorCanEditDocumentContent(prisma(false), user(), DOC)).toBe(false)
  })

  it('lets the realtime sidecar through despite its synthetic admin role', async () => {
    expect(await actorCanEditDocumentContent(prisma(false), user({ id: 'system:collab', role: 'tenant-admin' }), DOC)).toBe(true)
  })
})
