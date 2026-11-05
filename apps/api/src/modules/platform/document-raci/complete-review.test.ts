// Reviewers (C) and QC (Q) finishing their part: POST /documents/:id/raci/:raciId/complete.
// Own row only, during review only, and the last one finishing doesn't skip an open CRM.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'
import { resetRaciRound } from './access.js'

const DOC = 'doc-1'
type Row = Record<string, unknown> & { id: string; userId: string; letter: string }
const row = (id: string, userId: string, letter: string, over: Partial<Row> = {}): Row => ({
  id, documentId: DOC, userId, letter, sectionId: null, removedAt: null, rejectedAt: null, submittedAt: null,
  reviewedAt: null, approvedAt: null, signatureId: null, signatureRequired: false, ...over,
})

async function build(opts: { status: string; rows: Row[]; actor?: string; openMeetings?: number; openComments?: number }) {
  const { rows } = opts
  const document = { id: DOC, status: opts.status }
  const docUpdate = vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(document, data))
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ ...document })), update: docUpdate },
    documentRaci: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null),
      findMany: vi.fn(async () => rows),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find(r => r.id === where.id)!, data)),
    },
    crmMeeting: { count: vi.fn(async () => opts.openMeetings ?? 0) },
    comment: { count: vi.fn(async () => opts.openComments ?? 0) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: opts.actor ?? 'u-c', email: 'c@x', role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  const complete = (id: string) => app.inject({ method: 'POST', url: `/documents/${DOC}/raci/${id}/complete`, payload: {} })
  return { app, rows, document, docUpdate, append, complete }
}

describe('completing a review', () => {
  it.each([['C', 'in_review'], ['Q', 'in_review'], ['C', 'crm_in_progress'], ['Q', 'crm_in_progress']])('%s finishes during %s, and it is audited', async (letter, status) => {
    const t = await build({ status, rows: [row('r1', 'u-c', letter), row('r2', 'u-other', 'C')] })
    const res = await t.complete('r1')
    expect(res.statusCode).toBe(200)
    expect(t.rows[0]!.reviewedAt).not.toBeNull()
    expect(res.json().transition).toMatchObject({ cohortDone: 1, cohortTotal: 2, cohortComplete: false })
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'document_raci.completed' }))
    await t.app.close()
  })

  it.each(['not_started', 'in_authoring', 'pending_signature', 'signed'])('is refused while the document is %s', async (status) => {
    const t = await build({ status, rows: [row('r1', 'u-c', 'C')] })
    const res = await t.complete('r1')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_in_review')
    expect(t.rows[0]!.reviewedAt).toBeNull()
    await t.app.close()
  })

  it("can't complete someone else's row, or the same one twice", async () => {
    const other = await build({ status: 'in_review', rows: [row('r1', 'u-other', 'C')] })
    expect((await other.complete('r1')).statusCode).toBe(403)
    await other.app.close()
    const done = await build({ status: 'in_review', rows: [row('r1', 'u-c', 'Q', { reviewedAt: new Date() })] })
    expect((await done.complete('r1')).statusCode).toBe(409)
    await done.app.close()
  })

  it('asks for the signature on a row that requires one', async () => {
    const t = await build({ status: 'in_review', rows: [row('r1', 'u-c', 'C', { signatureRequired: true })] })
    const res = await t.complete('r1')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('signature_required')
    expect(t.rows[0]!.reviewedAt).toBeNull()
    await t.app.close()
  })
})

describe('the last person finishing', () => {
  const lastOne = () => [row('r1', 'u-c', 'C'), row('r2', 'u-q', 'Q', { reviewedAt: new Date() })]

  it('from In Review reports the cohort complete but leaves the document for the CRM', async () => {
    const t = await build({ status: 'in_review', rows: lastOne() })
    const res = await t.complete('r1')
    expect(res.json()).toMatchObject({ transitioned: false, transition: { cohortComplete: true } })
    expect(t.document.status).toBe('in_review')
    await t.app.close()
  })

  it('from CRM moves the document on when nothing is left open', async () => {
    const t = await build({ status: 'crm_in_progress', rows: lastOne() })
    const res = await t.complete('r1')
    expect(res.json().transitioned).toBe(true)
    expect(t.document.status).toBe('pending_signature')
    await t.app.close()
  })

  it.each([
    ['a meeting is still open', { openMeetings: 1 }],
    ['a comment is unresolved', { openComments: 2 }],
  ])("from CRM doesn't skip the meeting while %s", async (_label, open) => {
    const t = await build({ status: 'crm_in_progress', rows: lastOne(), ...open })
    const res = await t.complete('r1')
    expect(res.statusCode).toBe(200)
    expect(res.json().transitioned).toBe(false)
    expect(t.document.status).toBe('crm_in_progress')
    expect(t.docUpdate).not.toHaveBeenCalled()
    await t.app.close()
  })

  it("doesn't move the document while someone else is still reviewing", async () => {
    const t = await build({ status: 'crm_in_progress', rows: [row('r1', 'u-c', 'C'), row('r2', 'u-q', 'Q')] })
    expect((await t.complete('r1')).json().transitioned).toBe(false)
    expect(t.document.status).toBe('crm_in_progress')
    await t.app.close()
  })
})

describe('going back to authoring', () => {
  it('clears review marks as well as submissions, so the revised document is reviewed again', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    await resetRaciRound({ documentRaci: { updateMany } } as never, DOC)
    // One reset over every active row: submissions, C / Q review marks and approvals all cleared.
    expect(updateMany).toHaveBeenCalledWith({
      where: { documentId: DOC, removedAt: null },
      data:  expect.objectContaining({ submittedAt: null, reviewedAt: null, approvedAt: null }),
    })
  })
})
