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

const AI_CHAT_ROUTES = new Set(['AI suggest', 'accept an AI message'])

type BuildOpts = {
  rRow?: boolean
  assignee?: string
  withSection?: boolean       // the document's current version holds section 's1'
  lockHolder?: string         // someone holding a live section lock on 's1'
  projectStatus?: string      // 'closed' → status lock
  canSee?: boolean            // canSeeDocument (any RACI letter, assignee, creator)
  letters?: string[]          // RACI letters the caller holds on the document (rRow ⇒ ['R'])
}

async function build(actor: Partial<AuthenticatedUser>, opts: BuildOpts = {}) {
  const app = Fastify()
  const userId = actor.id ?? 'u-1'
  const now = new Date()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: DOC, projectId: 'p-1', type: 'csr_full', status: 'in_authoring', stage: 'study-start-up',
        deletedAt: null, assigneeId: opts.assignee ?? 'someone-else', currentVersionId: 'v1',
        currentVersion: { sections: opts.withSection
          ? [{ id: 'row-s1', sectionId: 's1', sectionNumber: '§1', sectionTitle: 'Synopsis', contentHtml: '<p>a</p>' }]
          : [] },
      })),
      count: vi.fn(async () => (opts.canSee === false ? 0 : 1)),
    },
    documentRaci: {
      findFirst: vi.fn(async ({ where }: { where?: { letter?: string } } = {}) => {
        if (where?.letter === undefined) return opts.rRow ? { id: 'raci-r' } : null
        return (opts.letters ?? (opts.rRow ? ['R'] : [])).includes(where.letter) ? { id: `raci-${where.letter}` } : null
      }),
      findMany:  vi.fn(async () => (opts.rRow ? [{ id: 'raci-r', userId, sectionId: null, submittedAt: null, rejectedAt: null }] : [])),
    },
    editHistory: {
      findUnique: vi.fn(async () => ({ documentId: DOC, sectionId: 's1' })),
      findMany:   vi.fn(async () => [{ id: 'edit-1', actorId: 'u-author', origin: 'ai', createdAt: now, beforeHtml: '<p>a</p>', afterHtml: '<p>b</p>',
        documentVersionId: 'v1', revertedFromId: null, aiCallRecordId: 'call-1', intent: 'edit', model: 'claude', promptText: null }]),
    },
    aiCallRecord: {
      findUnique: vi.fn(async () => ({ id: 'call-1', documentId: DOC, sectionId: 's1', preCallSectionHtml: '<p>a</p>', undoneAt: null })),
      findMany:   vi.fn(async () => [{ id: 'call-1', actorId: 'u-author', createdAt: now, model: 'claude', intent: 'edit', promptText: null,
        preCallSectionHtml: '<p>a</p>', postCallDocumentVersionId: 'v1', documentVersionId: 'v1', undoneAt: null, undoneBy: null }]),
    },
    aiConversationMessage: { findUnique: vi.fn(async () => ({ id: 'msg-1', documentId: DOC, sectionId: 's1', actorId: userId, role: 'assistant' })) },
    sectionLock: { findUnique: vi.fn(async () => (opts.lockHolder
      ? { documentId: DOC, sectionId: 's1', userId: opts.lockHolder, acquiredAt: now, lastHeartbeatAt: now }
      : null)) },
    project: { findUnique: vi.fn(async () => ({ id: 'p-1', status: opts.projectStatus ?? 'initiated' })) },
    user: { findMany: vi.fn(async () => [{ id: 'u-author', name: 'Ann Author' }]) },
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
    it.each(ROUTES)('cannot $name', async ({ name, method, url, payload }) => {
      const app = await build(actor)
      const res = await app.inject({ method, url, payload })
      expect(res.statusCode).toBe(403)
      // AI Chat is off for PMs altogether, so on the AI routes they hit that refusal first;
      // submitting for review is for authors (R) and has its own refusal.
      const expected = actor.role === 'pm' && AI_CHAT_ROUTES.has(name) ? 'ai_chat_not_allowed'
        : name === 'submit for review' ? 'submit_forbidden'
        : 'document_edit_forbidden'
      expect(res.json().error).toBe(expected)
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

  it('gives the realtime sidecar no exemption — it saves as the author who typed (x-acting-user)', async () => {
    expect(await actorCanEditDocumentContent(prisma(false), user({ id: 'system:collab', role: 'tenant-admin' }), DOC)).toBe(false)
  })
})

describe('AI Chat is turned off for Project Managers', () => {
  const aiRoutes = ROUTES.filter(r => AI_CHAT_ROUTES.has(r.name))

  it.each(aiRoutes)('a PM is refused "$name" even as an author (assignee holding an R row)', async ({ method, url, payload }) => {
    const app = await build({ id: 'u-pm', role: 'pm' }, { rRow: true, assignee: 'u-pm' })
    const res = await app.inject({ method, url, payload })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'ai_chat_not_allowed', message: 'AI Chat is not available to Project Managers.' })
    await app.close()
  })

  it.each(aiRoutes)('the PM rule does not block a contributor author on "$name"', async ({ method, url, payload }) => {
    const app = await build({ id: 'u-w', role: 'contributor' }, { rRow: true, assignee: 'u-w' })
    const res = await app.inject({ method, url, payload })
    expect(res.json().error).not.toBe('ai_chat_not_allowed')
    await app.close()
  })
})

// AI routes follow editing rights: R (or the assignee) — and, like a section save, the status lock
// and the section lock. Suggest, accept, undo and revert all go through the same gate.
describe('AI routes follow editing rights, the status lock and the section lock', () => {
  const AI_EDIT_ROUTES = ROUTES.filter(r => ['AI suggest', 'accept an AI message', 'undo an AI call', 'revert an edit'].includes(r.name))
  const author = { id: 'u-author', role: 'contributor' as const }

  it.each(AI_EDIT_ROUTES)('an author is refused "$name" (423) while someone else holds the section lock', async ({ method, url, payload }) => {
    const app = await build(author, { rRow: true, withSection: true, lockHolder: 'u-other' })
    const res = await app.inject({ method, url, payload })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'locked', holder: { userId: 'u-other' } })
    await app.close()
  })

  it.each(AI_EDIT_ROUTES)('an author is refused "$name" (409) when the document is locked for authoring', async ({ method, url, payload }) => {
    const app = await build(author, { rRow: true, withSection: true, projectStatus: 'closed' })
    const res = await app.inject({ method, url, payload })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('document_locked')
    await app.close()
  })

  it.each(AI_EDIT_ROUTES)('the author\'s own section lock does not block "$name"', async ({ method, url, payload }) => {
    const app = await build(author, { rRow: true, withSection: true, lockHolder: 'u-author' })
    const res = await app.inject({ method, url, payload })
    // Past the gate: whatever later step the stub trips on, it isn't a rights / status-lock / section-lock refusal.
    const error = (() => { try { return res.json().error as string | undefined } catch { return undefined } })()
    expect(['document_edit_forbidden', 'document_locked', 'locked']).not.toContain(error)
    await app.close()
  })

  it.each(AI_EDIT_ROUTES)('a reviewer (C, not an author) is refused "$name" (403)', async ({ method, url, payload }) => {
    const app = await build({ id: 'u-rev', role: 'contributor' }, { withSection: true })
    const res = await app.inject({ method, url, payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('document_edit_forbidden')
    await app.close()
  })
})

describe('reviewers see AI history read-only', () => {
  const reviewer = { id: 'u-rev', role: 'contributor' as const }

  it('a reviewer can read the section history, with Revert not offered', async () => {
    const app = await build(reviewer, { withSection: true })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/sections/s1/history` })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ canRevert: boolean }>
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every(e => e.canRevert === false)).toBe(true)
    await app.close()
  })

  it('a reviewer can read the AI-call history, with Undo not offered', async () => {
    const app = await build(reviewer, { withSection: true })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/sections/s1/ai-history` })
    expect(res.statusCode).toBe(200)
    const calls = (res.json().calls ?? res.json().entries ?? res.json().items) as Array<{ canUndo: boolean }>
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(c => c.canUndo === false)).toBe(true)
    await app.close()
  })

  it('the author is offered Revert and Undo on the same history', async () => {
    const app = await build({ id: 'u-author', role: 'contributor' }, { rRow: true, withSection: true })
    const hist = await app.inject({ method: 'GET', url: `/documents/${DOC}/sections/s1/history` })
    expect((hist.json().entries as Array<{ canRevert: boolean }>).some(e => e.canRevert)).toBe(true)
    const ai = await app.inject({ method: 'GET', url: `/documents/${DOC}/sections/s1/ai-history` })
    const calls = (ai.json().calls ?? ai.json().entries ?? ai.json().items) as Array<{ canUndo: boolean }>
    expect(calls.some(c => c.canUndo)).toBe(true)
    await app.close()
  })

  it.each([['section history', 'history'], ['AI-call history', 'ai-history']])('someone who cannot see the document gets 404 for the %s', async (_l, path) => {
    const app = await build({ id: 'u-stranger', role: 'contributor' }, { withSection: true, canSee: false })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/sections/s1/${path}` })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('references: link and remove are for authors (R); C, Q, A, I and auditors are view-only', () => {
  const REF_ROUTES = ROUTES.filter(r => r.name === 'add a reference' || r.name === 'remove a reference')

  it.each(['C', 'Q', 'A', 'I'])('someone holding only %s is refused both (403)', async (letter) => {
    for (const { method, url, payload } of REF_ROUTES) {
      const app = await build({ id: 'u-x', role: 'contributor' }, { letters: [letter] })
      const res = await app.inject({ method, url, payload })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('document_edit_forbidden')
      await app.close()
    }
  })

  it('an auditor is refused even holding R and being the assignee (view-only role)', async () => {
    for (const { method, url, payload } of [...REF_ROUTES, ROUTES.find(r => r.name === 'save a section')!]) {
      const app = await build({ id: 'u-aud', role: 'auditor' }, { rRow: true, assignee: 'u-aud' })
      const res = await app.inject({ method, url, payload })
      expect(res.statusCode).toBe(403)
      await app.close()
    }
  })

  it('an author (R) gets past the rights check; a closed project still refuses (status lock)', async () => {
    for (const { method, url, payload } of REF_ROUTES) {
      const open = await build({ id: 'u-author', role: 'contributor' }, { rRow: true })
      const ok = await open.inject({ method, url, payload })
      expect(ok.json().error).not.toBe('document_edit_forbidden')
      await open.close()

      const closed = await build({ id: 'u-author', role: 'contributor' }, { rRow: true, projectStatus: 'closed' })
      const res = await closed.inject({ method, url, payload })
      expect(res.statusCode).toBe(423)
      expect(res.json().error).toBe('document_locked')
      await closed.close()
    }
  })
})
