// GET /documents/:id/pending — who the document is waiting on and who was reminded in the last 24 hours
// (CW-027). For authors (R) only, like the reminder itself.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

type Row = Record<string, unknown>
const row = (userId: string, letter: string, extra: Row = {}): Row => ({
  userId, letter, sectionId: null, signatureRequired: false, submittedAt: null, reviewedAt: null,
  approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null, ...extra,
})

async function build(actor: Partial<AuthenticatedUser>, status = 'in_review') {
  const reminders = [{ recipientId: 'u-cara', createdAt: new Date('2026-11-06T08:00:00Z') }]
  const notificationFindMany = vi.fn(async () => reminders)
  const rows = [row('u-ann', 'R', { submittedAt: new Date('2026-11-01T00:00:00Z') }), row('u-cara', 'C'), row('u-quinn', 'Q', { reviewedAt: new Date() }), row('u-ava', 'A')]
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: async () => ({ status: 'ongoing' }) },
    document: { findUnique: vi.fn(async () => ({ id: 'd-1', status, title: 'CSR', projectId: 'p-1', assigneeId: 'u-ann' })), count: async () => 1 },
    documentRaci: { findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter(r => where.letter === undefined || r.letter === where.letter)), findFirst: vi.fn(async ({ where }: { where: { userId: string; letter?: string } }) => (where.userId === 'u-ann' && (!where.letter || where.letter === 'R') ? { id: 'r' } : null)) },
    user: { findMany: vi.fn(async () => [{ id: 'u-cara', name: 'Cara Reviewer' }, { id: 'u-quinn', name: 'Quinn QC' }]) },
    notification: { findMany: notificationFindMany },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: AuthenticatedUser }).user = { id: 'u-ann', email: 'x@x', role: 'contributor', modules: ['A'], tenantId: null, ...actor } as AuthenticatedUser
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, notificationFindMany }
}

process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'

describe('GET /documents/:id/pending', () => {
  it('lists who a document in review is waiting on (Reviewer and QC not yet done) with the last reminder', async () => {
    const { app, notificationFindMany } = await build({})
    const res = await app.inject({ method: 'GET', url: '/documents/d-1/pending' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect([...body.gatingLetters].sort()).toEqual(['C', 'Q'])
    expect(body.pending).toEqual([{ userId: 'u-cara', name: 'Cara Reviewer', letter: 'C', remindedAt: '2026-11-06T08:00:00.000Z' }])
    // Quinn's QC row is done, so only the reviewer is waited on; reminders are read from the last 24 hours of this document
    const where = (notificationFindMany.mock.calls[0] as unknown as [{ where: { kind: string; payload: { path: string[]; equals: string } } }])[0].where
    expect(where.kind).toBe('document_nudge')
    expect(where.payload).toEqual({ path: ['documentId'], equals: 'd-1' })
  })

  it('leaves the caller out: an Author is not waiting on themselves', async () => {
    const { app } = await build({}, 'in_authoring')
    const body = (await app.inject({ method: 'GET', url: '/documents/d-1/pending' })).json()
    expect(body.pending.map((p: { userId: string }) => p.userId)).not.toContain('u-ann')
  })

  it.each([
    ['a reviewer', { id: 'u-cara' }],
    ['a PM', { id: 'u-pm', role: 'pm' }],
    ['an admin', { id: 'u-ta', role: 'tenant-admin' }],
  ])('is refused to %s, as the reminder itself is', async (_who, actor) => {
    const { app } = await build(actor)
    const res = await app.inject({ method: 'GET', url: '/documents/d-1/pending' })
    expect(res.statusCode).toBe(403)
  })
})
