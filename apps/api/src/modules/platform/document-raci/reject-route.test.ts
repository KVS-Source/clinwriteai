// POST /documents/:id/raci/:raciId/reject — a Reviewer (C), QC (Q) or Approver (A)
// returns the document to authoring with a required note. The document goes back
// to in_authoring, a new version snapshot is taken (review / CRM / signature
// bounce), any open signature chain is cancelled, and a new round starts.
// Fastify inject() with a stateful in-memory stub; the snapshot itself is
// DocumentService.createVersionSnapshot (tested in update-section.test.ts).

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

const snapshot = vi.hoisted(() => vi.fn(async () => ({ version: { id: 'ver-new', versionNumber: 'v0.3' } })))
vi.mock('../../clinical-writing/documents/service.js', () => ({
  DocumentService: class { createVersionSnapshot = snapshot },
}))
const { documentRaciRoutes } = await import('./routes.js')

type Row = Record<string, unknown>
const DOC = 'DOC-1'
const done = new Date('2026-11-01T00:00:00Z')

async function build(status: string, me = 'u-rev') {
  snapshot.mockClear()
  const doc: Row = { id: DOC, status, title: 'Protocol v2', projectId: 'PROJ-1', assigneeId: 'u-assignee' }
  const rows: Row[] = [
    { id: 'r-1', documentId: DOC, userId: 'u-author', letter: 'R', sectionId: null, submittedAt: done, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, removedAt: null },
    { id: 'c-1', documentId: DOC, userId: 'u-rev',    letter: 'C', sectionId: null, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, removedAt: null },
    { id: 'q-1', documentId: DOC, userId: 'u-qc',     letter: 'Q', sectionId: null, submittedAt: null, reviewedAt: done, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, removedAt: null },
    { id: 'a-1', documentId: DOC, userId: 'u-app',    letter: 'A', sectionId: null, submittedAt: null, reviewedAt: null, approvedAt: done, signatureId: 'sig-1', rejectedAt: null, rejectionNote: null, removedAt: null },
  ]
  const chains: Row[] = [
    { id: 'ch-open', documentId: DOC, status: 'in_progress', cancelledAt: null, cancelReason: null },
    { id: 'ch-done', documentId: DOC, status: 'complete',    cancelledAt: null, cancelReason: null },
  ]
  const audit: Array<{ action: string; details: Row }> = []
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ ...doc })),
      update:     vi.fn(async ({ data }: { data: Row }) => Object.assign(doc, data)),
    },
    documentRaci: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null),
      findMany:   vi.fn(async ({ where }: { where: { letter: string } }) => rows.filter(r => r.letter === where.letter && !r.removedAt)),
      update:     vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(rows.find(r => r.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rows.filter(r => r.documentId === where.documentId && r.removedAt === where.removedAt)
        hit.forEach(r => Object.assign(r, data))
        return { count: hit.length }
      }),
    },
    signatureChain: {
      updateMany: vi.fn(async ({ where, data }: { where: { documentId: string; status: { in: string[] } }; data: Row }) => {
        const hit = chains.filter(c => c.documentId === where.documentId && where.status.in.includes(c.status as string))
        hit.forEach(c => Object.assign(c, data))
        return { count: hit.length }
      }),
    },
    project: { findUnique: vi.fn(async () => ({ status: 'ongoing' })) },
    comment: { count: vi.fn(async () => 0) },
    user: {
      findUnique: vi.fn(async () => ({ name: 'Rita Reviewer' })),
      findMany:   vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id, name: 'Rita Reviewer' }))),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: { action: string; details: Row }) => { audit.push(e); return {} }) } as never)
  const notify = vi.fn(async (_n: Row) => ({}))
  app.decorate('notifications', { send: notify } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    // A test with several people sends `x-user` to act as someone else.
    const id = (req.headers['x-user'] as string | undefined) ?? me
    const user: AuthenticatedUser = { id, email: `${id}@x`, role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  const reject = (raciId: string, body: unknown, as?: string) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/raci/${raciId}/reject`, payload: body as never, headers: as ? { 'x-user': as } : {} })
  const complete = (raciId: string, as?: string) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/raci/${raciId}/complete`, payload: {}, headers: as ? { 'x-user': as } : {} })
  return { doc, rows, chains, audit, reject, complete, notify }
}

// With more than one Reviewer (C) the document waits for all of them: each marks their review done or returns it.
// A return among otherwise-approving Reviewers still sends it back, but only once the last Reviewer has finished.
describe('several Reviewers: the document moves only when all have finished', () => {
  const twoReviewers = async (status = 'in_review') => {
    const t = await build(status, 'u-rev')
    for (const r of t.rows) if (r.letter === 'C') r.approvalOrder = null
    t.rows.push({ id: 'c-2', documentId: DOC, userId: 'u-rev2', letter: 'C', sectionId: null, approvalOrder: null, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, removedAt: null })
    return t
  }

  it('one Reviewer returns it while another is still reviewing: recorded, nothing moves', async () => {
    const t = await twoReviewers()
    const res = await t.reject('c-1', { note: 'Dose table is wrong.' }, 'u-rev')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ deferred: true, document: { id: DOC, status: 'in_review' } })
    expect(res.json().waitingFor).toEqual([{ userId: 'u-rev2', name: 'Rita Reviewer' }])
    expect(t.doc.status).toBe('in_review')
    expect(snapshot).not.toHaveBeenCalled()
    expect(t.rows.find(r => r.id === 'c-1')).toMatchObject({ rejectedAt: expect.any(Date), rejectionNote: 'Dose table is wrong.' })
    expect(t.audit.map(e => e.action)).toContain('document_raci.rejection_recorded')
    expect(t.audit.map(e => e.action)).not.toContain('document_status_changed')
  })

  it('the other Reviewer then marks done: the document goes back to authoring, with the first one\'s note', async () => {
    const t = await twoReviewers()
    await t.reject('c-1', { note: 'Dose table is wrong.' }, 'u-rev')
    const res = await t.complete('c-2', 'u-rev2')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ returnedToAuthoring: true, document: { status: 'in_authoring' }, version: { versionNumber: 'v0.3' } })
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledWith({ documentId: DOC, createdBy: 'u-rev', reason: 'review_bounce', note: 'Dose table is wrong.' })
    // A new round: nobody is left marked done or returned.
    expect(t.rows.find(r => r.id === 'c-1')).toMatchObject({ rejectedAt: null })
    expect(t.rows.find(r => r.id === 'c-2')).toMatchObject({ reviewedAt: null })
  })

  it('the other Reviewer returns it too: goes back as soon as the last one has finished', async () => {
    const t = await twoReviewers()
    expect((await t.reject('c-1', { note: 'First reason.' }, 'u-rev')).json().deferred).toBe(true)
    const res = await t.reject('c-2', { note: 'Second reason.' }, 'u-rev2')
    expect(res.json()).toMatchObject({ document: { status: 'in_authoring' } })
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledOnce()
  })

  it('a Reviewer who already marked done, then the last one returns it: back to authoring at once', async () => {
    const t = await twoReviewers()
    expect((await t.complete('c-1', 'u-rev')).json().returnedToAuthoring).toBeUndefined()
    expect(t.doc.status).toBe('in_review')
    const res = await t.reject('c-2', { note: 'Needs a rewrite.' }, 'u-rev2')
    expect(res.json()).toMatchObject({ document: { status: 'in_authoring' } })
    expect(t.doc.status).toBe('in_authoring')
  })

  it('everyone marks done: no one returned it, so the document is not sent back', async () => {
    const t = await twoReviewers()
    await t.complete('c-1', 'u-rev')
    const res = await t.complete('c-2', 'u-rev2')
    expect(res.statusCode).toBe(200)
    expect(res.json().returnedToAuthoring).toBeUndefined()
    expect(t.doc.status).toBe('in_review')
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('a Reviewer who returned it cannot also mark their review done', async () => {
    const t = await twoReviewers()
    await t.reject('c-1', { note: 'No.' }, 'u-rev')
    const res = await t.complete('c-1', 'u-rev')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('row_rejected')
  })

  it('QC still sends it back straight away, whatever the Reviewers are doing', async () => {
    const qc = await twoReviewers('in_review')
    expect((await qc.reject('q-1', { note: 'Listings incomplete.' }, 'u-qc')).json()).toMatchObject({ document: { status: 'in_authoring' } })
  })

  it('a Reviewer returning it while the document awaits signature still sends it back at once (they are not the gate there)', async () => {
    const t = await twoReviewers('pending_signature')
    expect((await t.reject('c-1', { note: 'Spotted late.' }, 'u-rev')).json()).toMatchObject({ document: { status: 'in_authoring' } })
  })
})

// The same rule for Approvers (A) while the document awaits signature: a return is recorded, signing carries on for
// the others, and the document goes back only when every Approver has approved (signed) or returned it.
describe('several Approvers: the document moves only when all have finished', () => {
  const twoApprovers = async () => {
    const t = await build('pending_signature', 'u-app')
    t.rows.push({ id: 'a-2', documentId: DOC, userId: 'u-app2', letter: 'A', sectionId: null, approvalOrder: null, submittedAt: null, reviewedAt: null, approvedAt: null, documentApprovedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, removedAt: null })
    const a1 = t.rows.find(r => r.id === 'a-1')!
    a1.documentApprovedAt = null   // a-1 has not approved yet in these scenarios
    return t
  }

  it('one Approver returns it while another has not decided: recorded, the document stays awaiting signature and the chain stays open', async () => {
    const t = await twoApprovers()
    const res = await t.reject('a-1', { note: 'Wrong signatory.' }, 'u-app')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ deferred: true, document: { id: DOC, status: 'pending_signature' } })
    expect(res.json().waitingFor).toEqual([{ userId: 'u-app2', name: 'Rita Reviewer' }])
    expect(t.doc.status).toBe('pending_signature')
    expect(snapshot).not.toHaveBeenCalled()
    expect(t.chains.find(c => c.id === 'ch-open')).toMatchObject({ status: 'in_progress' })
    expect(t.rows.find(r => r.id === 'a-1')).toMatchObject({ rejectedAt: expect.any(Date), rejectionNote: 'Wrong signatory.' })
  })

  it('the other Approver returns it too: goes back to authoring, signing is cancelled, with a signature-bounce snapshot', async () => {
    const t = await twoApprovers()
    expect((await t.reject('a-1', { note: 'First.' }, 'u-app')).json().deferred).toBe(true)
    const res = await t.reject('a-2', { note: 'Second.' }, 'u-app2')
    expect(res.json()).toMatchObject({ document: { status: 'in_authoring' } })
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ reason: 'signature_bounce' }))
    expect(t.chains.find(c => c.id === 'ch-open')).toMatchObject({ status: 'cancelled' })
    expect(t.rows.find(r => r.id === 'a-1')).toMatchObject({ rejectedAt: null })   // a new round
  })

  it('the other Approver already approved and signed: the return sends it back at once', async () => {
    const t = await twoApprovers()
    t.rows.find(r => r.id === 'a-2')!.documentApprovedAt = done
    const res = await t.reject('a-1', { note: 'Needs another look.' }, 'u-app')
    expect(res.json()).toMatchObject({ document: { status: 'in_authoring' } })
    expect(t.doc.status).toBe('in_authoring')
  })

  it('an Approver who returned it cannot return it twice', async () => {
    const t = await twoApprovers()
    await t.reject('a-1', { note: 'First.' }, 'u-app')
    expect((await t.reject('a-1', { note: 'Again.' }, 'u-app')).json().error).toBe('already_rejected')
  })
})

describe('returning a document to authoring', () => {
  it('a reviewer (C) returns it from review: back to authoring, new version snapshot, new round', async () => {
    const t = await build('in_review', 'u-rev')
    const res = await t.reject('c-1', { note: 'Section 9 contradicts the SAP.' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ document: { status: 'in_authoring' }, version: { id: 'ver-new', versionNumber: 'v0.3' } })
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledWith({ documentId: DOC, createdBy: 'u-rev', reason: 'review_bounce', note: 'Section 9 contradicts the SAP.' })

    // New round: author submits again, QC and approver review / approve again; nobody left "rejected".
    expect(t.rows.find(r => r.id === 'r-1')).toMatchObject({ submittedAt: null })
    expect(t.rows.find(r => r.id === 'q-1')).toMatchObject({ reviewedAt: null })
    expect(t.rows.find(r => r.id === 'a-1')).toMatchObject({ approvedAt: null, signatureId: null })
    expect(t.rows.find(r => r.id === 'c-1')).toMatchObject({ rejectedAt: null, rejectionNote: 'Section 9 contradicts the SAP.' })

    const status = t.audit.find(e => e.action === 'document_status_changed')
    expect(status?.details).toMatchObject({ from: 'in_review', to: 'in_authoring', trigger: 'raci_reject', letter: 'C', snapshotVersionId: 'ver-new' })
    expect(t.audit.some(e => e.action === 'document_raci.rejected')).toBe(true)
  })

  it('QC (Q) returns it from a CRM → a CRM-bounce snapshot', async () => {
    const t = await build('crm_in_progress', 'u-qc')
    expect((await t.reject('q-1', { note: 'Listings incomplete.' })).statusCode).toBe(200)
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ reason: 'crm_bounce' }))
  })

  it.each(['in_review', 'crm_in_progress'])('an approver (A) can read it while %s but not return it yet', async (status) => {
    const t = await build(status, 'u-app')
    const res = await t.reject('a-1', { note: 'Too early.' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('approver_not_yet')
    expect(t.doc.status).toBe(status)
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('an approver (A) returns it while awaiting signature → signature-bounce snapshot; the open chain is cancelled', async () => {
    const t = await build('pending_signature', 'u-app')
    expect((await t.reject('a-1', { note: 'Wrong signatory order.' })).statusCode).toBe(200)
    expect(t.doc.status).toBe('in_authoring')
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ reason: 'signature_bounce' }))
    expect(t.chains.find(c => c.id === 'ch-open')).toMatchObject({ status: 'cancelled', cancelReason: 'Returned to authoring: Wrong signatory order.' })
    expect(t.chains.find(c => c.id === 'ch-done')!.status).toBe('complete')
  })

  it.each([['no note', {}], ['an empty note', { note: '' }], ['a blank note', { note: '   ' }]])('%s is refused (400) and nothing changes', async (_l, body) => {
    const t = await build('in_review', 'u-rev')
    const res = await t.reject('c-1', body)
    expect(res.statusCode).toBe(400)
    expect(t.doc.status).toBe('in_review')
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('the author (R) cannot use it (422); nor can someone use another person\'s row (403)', async () => {
    const author = await build('in_review', 'u-author')
    expect((await author.reject('r-1', { note: 'x' })).statusCode).toBe(422)
    const other = await build('in_review', 'u-qc')
    expect((await other.reject('c-1', { note: 'x' })).statusCode).toBe(403)
    expect(other.doc.status).toBe('in_review')
  })

  it('notifies every author, with the reason and a link to the document', async () => {
    const t = await build('in_review', 'u-rev')
    t.rows.push({ ...t.rows[0], id: 'r-2', userId: 'u-author-2' })
    await t.reject('c-1', { note: 'Section 9 contradicts the SAP.' })

    expect(t.notify.mock.calls.map(([n]) => n.recipientId)).toEqual(['u-author', 'u-author-2'])
    expect(t.notify.mock.calls[0][0]).toMatchObject({
      kind:     'document.returned_to_authoring',
      title:    'Rita Reviewer returned "Protocol v2" to authoring',
      body:     'Now v0.3. Reason: Section 9 contradicts the SAP.',
      linkPath: `/projects/PROJ-1/clinical-writing/documents/${DOC}`,
    })
  })

  it('notifies the assignee when there are no R rows, and never the person returning it', async () => {
    const noAuthors = await build('in_review', 'u-rev')
    noAuthors.rows.find(r => r.id === 'r-1')!.removedAt = done
    await noAuthors.reject('c-1', { note: 'x' })
    expect(noAuthors.notify.mock.calls.map(([n]) => n.recipientId)).toEqual(['u-assignee'])

    const alsoAuthor = await build('in_review', 'u-rev')
    alsoAuthor.rows.find(r => r.id === 'r-1')!.userId = 'u-rev'
    await alsoAuthor.reject('c-1', { note: 'x' })
    expect(alsoAuthor.notify).not.toHaveBeenCalled()
  })

  it('a failed notification does not fail the return', async () => {
    const t = await build('in_review', 'u-rev')
    t.notify.mockRejectedValue(new Error('down'))
    expect((await t.reject('c-1', { note: 'x' })).statusCode).toBe(200)
    expect(t.doc.status).toBe('in_authoring')
  })

  it('a refused return notifies nobody', async () => {
    const t = await build('in_authoring', 'u-rev')
    await t.reject('c-1', { note: 'x' })
    expect(t.notify).not.toHaveBeenCalled()
  })

  it.each(['in_authoring', 'not_started', 'signed'])('a document that is %s cannot be returned (409) and no snapshot is taken', async (status) => {
    const t = await build(status, 'u-rev')
    const res = await t.reject('c-1', { note: 'x' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_returnable')
    expect(t.doc.status).toBe(status)
    expect(snapshot).not.toHaveBeenCalled()
  })
})
