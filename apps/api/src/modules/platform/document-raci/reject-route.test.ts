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
  const doc: Row = { id: DOC, status }
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
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: { action: string; details: Row }) => { audit.push(e); return {} }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: me, email: `${me}@x`, role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  const reject = (raciId: string, body: unknown) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/raci/${raciId}/reject`, payload: body as never })
  return { doc, rows, chains, audit, reject }
}

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

  it.each(['in_authoring', 'not_started', 'signed'])('a document that is %s cannot be returned (409) and no snapshot is taken', async (status) => {
    const t = await build(status, 'u-rev')
    const res = await t.reject('c-1', { note: 'x' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_returnable')
    expect(t.doc.status).toBe(status)
    expect(snapshot).not.toHaveBeenCalled()
  })
})
