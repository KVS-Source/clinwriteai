// CW-036 (FR-A-042): submitting for a *sequential* review puts the document's Reviewers (C) in a line, in the
// order of the panel's list, and tells only the first; a parallel review clears the line and tells everyone.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))

async function build() {
  const places: Array<{ userId: string; approvalOrder: number | null }> = []
  const sent: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ id: 'DOC-1', projectId: 'proj-1', title: 'CSR', status: 'in_authoring', stage: 'legacy' })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'DOC-1', ...args.data })),
    },
    checklistInstanceItem: { findMany: vi.fn(async () => []) },
    documentRaci: {
      // u1 is the only author; the reviewers were added in this order: rev-a, rev-b, rev-c.
      findMany: vi.fn(async ({ where }: { where: { letter: string } }) => where.letter === 'R'
        ? [{ id: 'raci-r', userId: 'u1', sectionId: null, submittedAt: null, rejectedAt: null }]
        : [{ userId: 'rev-a' }, { userId: 'rev-b' }, { userId: 'rev-c' }]),
      updateMany: vi.fn(async ({ where, data }: { where: { letter?: string; userId?: string }; data: { approvalOrder?: number | null } }) => {
        if (where.letter === 'C' && where.userId) places.push({ userId: where.userId, approvalOrder: data.approvalOrder ?? null })
        return { count: 1 }
      }),
    },
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', status: 'initiated' })) },
    user:    { findMany: vi.fn(async () => []) },
  } as never)
  const append = vi.fn(async (_e: { action: string; details: Record<string, unknown> }) => undefined)
  app.decorate('audit', { append } as never)
  app.decorate('notifications', { send: vi.fn(async (n: Record<string, unknown>) => { sent.push(n); return n }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, places, sent, append }
}

const submit = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/submit-for-review', payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('submit-for-review — reviewer order', () => {
  it('sequential: the panel order becomes the line, unnamed reviewers follow, and only the first is told', async () => {
    const t = await build()
    const res = await submit(t.app, {
      reviewType: 'sequential',
      reviewers: [{ userId: 'rev-c', raci: 'C' }, { userId: 'someone-else', raci: 'I' }, { userId: 'rev-a', raci: 'C' }],
    })
    expect(res.statusCode).toBe(200)
    expect(t.places).toEqual([{ userId: 'rev-c', approvalOrder: 1 }, { userId: 'rev-a', approvalOrder: 2 }, { userId: 'rev-b', approvalOrder: 3 }])
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({ recipientId: 'rev-c', kind: 'review_requested', linkPath: '/projects/proj-1/clinical-writing/documents/DOC-1/review', payload: { sequential: true } })
    expect(t.sent[0]!.title).toContain("your turn")
    const audit = t.append.mock.calls.map(c => c[0]).find(e => e.action === 'document_submitted_for_review')
    expect(audit?.details.reviewLine).toEqual([{ userId: 'rev-c', place: 1 }, { userId: 'rev-a', place: 2 }, { userId: 'rev-b', place: 3 }])
    await t.app.close()
  })

  it('parallel: no line (any old one is cleared) and every reviewer is told', async () => {
    const t = await build()
    const res = await submit(t.app, { reviewType: 'parallel', reviewers: [] })
    expect(res.statusCode).toBe(200)
    expect(t.places.every(p => p.approvalOrder === null)).toBe(true)
    expect(t.places).toHaveLength(3)
    expect(t.sent.map(n => n.recipientId).sort()).toEqual(['rev-a', 'rev-b', 'rev-c'])
    expect(t.sent.every(n => (n.payload as { sequential: boolean }).sequential === false)).toBe(true)
    await t.app.close()
  })

  it('a submit with no review type is parallel', async () => {
    const t = await build()
    expect((await submit(t.app, {})).statusCode).toBe(200)
    expect(t.places.every(p => p.approvalOrder === null)).toBe(true)
    await t.app.close()
  })
})
