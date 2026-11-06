// POST /documents/:id/submit-for-review stores the review due date from the
// Submit-for-review panel, and still submits when documents.reviewDueAt is
// missing (migration 52 not applied). Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

// Who may submit is covered by documents/submit-for-review-authors.test.ts; this file
// tests what happens once an author is let through.
vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))

async function build(opts: { columnMissing?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    // stage outside the DB stage set → the stage gate and stage auto-advance are skipped
    document: {
      findUnique: vi.fn(async () => ({ id: 'DOC-1', projectId: 'proj-1', status: 'in_authoring', stage: 'legacy' })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (opts.columnMissing && 'reviewDueAt' in args.data) {
          throw Object.assign(new Error('The column `documents.reviewDueAt` does not exist in the current database.'), { code: 'P2022' })
        }
        updates.push(args.data)
        return { id: 'DOC-1', ...args.data }
      }),
    },
    checklistInstanceItem: { findMany: vi.fn(async () => []) },
    // u1 is the document's only author (R), so their submission sends it to review.
    documentRaci: {
      findMany:   vi.fn(async () => [{ id: 'raci-r', userId: 'u1', sectionId: null, submittedAt: null, rejectedAt: null }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', status: 'initiated' })) },
    user:    { findMany: vi.fn(async () => []) },
  } as never)
  const append = vi.fn(async (_event: { action: string; details: Record<string, unknown> }) => undefined)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, updates, append }
}

const submit = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/submit-for-review', payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('submit-for-review — review due date', () => {
  it('stores the due date as UTC midnight of the chosen day and audits it', async () => {
    const { app, updates, append } = await build()
    const res = await submit(app, { reviewType: 'parallel', reviewers: [], dueDate: '2099-11-05' })
    expect(res.statusCode).toBe(200)
    expect(updates[0]).toMatchObject({ status: 'in_review', reviewDueAt: new Date('2099-11-05T00:00:00.000Z') })
    const audit = append.mock.calls.map(c => c[0]).find(e => e.action === 'document_submitted_for_review')
    expect(audit?.details).toMatchObject({ reviewDueAt: '2099-11-05T00:00:00.000Z' })
  })

  it('records the review type and reviewers on the audit trail', async () => {
    const { app, append } = await build()
    const reviewers = [{ userId: 'u2', raci: 'C' }, { userId: 'u3', raci: 'A' }]
    await submit(app, { reviewType: 'sequential', reviewers, dueDate: '2099-11-05' })
    const audit = append.mock.calls.map(c => c[0]).find(e => e.action === 'document_submitted_for_review')
    expect(audit?.details).toMatchObject({ reviewType: 'sequential', reviewers })
  })

  it('still submits, and keeps the due date, when the review type or reviewers are malformed', async () => {
    const { app, updates, append } = await build()
    const res = await submit(app, { reviewType: 'whenever', reviewers: 'everyone', dueDate: '2099-11-05' })
    expect(res.statusCode).toBe(200)
    expect(updates[0]).toMatchObject({ reviewDueAt: new Date('2099-11-05T00:00:00.000Z') })
    const audit = append.mock.calls.map(c => c[0]).find(e => e.action === 'document_submitted_for_review')
    expect(audit?.details).toMatchObject({ reviewType: null, reviewers: [] })
  })

  it('stores null when no valid due date is sent', async () => {
    const { app, updates } = await build()
    await submit(app, { dueDate: 'not-a-date' })
    expect(updates[0]).toMatchObject({ status: 'in_review', reviewDueAt: null })
  })

  it('still submits without the due date when the column is missing', async () => {
    const { app, updates } = await build({ columnMissing: true })
    const res = await submit(app, { dueDate: '2099-11-05' })
    expect(res.statusCode).toBe(200)
    expect(updates[0]).toMatchObject({ status: 'in_review' })
    expect(updates[0]).not.toHaveProperty('reviewDueAt')
  })
})

describe('submit-for-review — a due date already passed', () => {
  it('is refused, and the document is not submitted', async () => {
    const { app, updates } = await build()
    const res = await submit(app, { reviewType: 'parallel', reviewers: [], dueDate: '2025-01-01' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('date_in_past')
    expect(updates).toEqual([])
  })
})
