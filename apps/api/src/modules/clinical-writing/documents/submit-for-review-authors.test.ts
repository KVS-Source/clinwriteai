// Submit for review is for authors only: each R submits their own part, the
// mandatory-checklist gate (Gate C) applies to every submission, and the
// document goes to in_review only once every active R has submitted.
// The two side doors into review — /transition to in_review and completing an
// R row through the RACI routes — are closed. Fastify inject() with a stateful
// in-memory Prisma stub.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'
import { documentRaciRoutes } from '../../platform/document-raci/routes.js'
import { resetAuthorSubmissions } from '../../platform/document-raci/access.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub
const DOC = 'DOC-1'
const NAMES: Record<string, string> = { 'u-a': 'Ann Author', 'u-b': 'Ben Author', 'u-pm': 'Pat PM', 'u-rev': 'Rae Reviewer' }

const rRow = (id: string, userId: string, extra: Row = {}): Row =>
  ({ id, documentId: DOC, userId, letter: 'R', sectionId: null, submittedAt: null, rejectedAt: null, removedAt: null, signatureRequired: false, ...extra })

async function build(opts: { raci?: Row[]; status?: string; stage?: string; assignee?: string; blocking?: Row[] } = {}) {
  const doc: Row = { id: DOC, projectId: 'p-1', status: opts.status ?? 'in_authoring', stage: opts.stage ?? 'legacy',
    assigneeId: opts.assignee ?? 'u-a', currentVersionId: 'v1', deletedAt: null }
  const raci: Row[] = opts.raci ?? []
  const audit: Row[] = []
  let current: AuthenticatedUser = { id: 'u-a', email: 'a@x', role: 'contributor', modules: ['A'], tenantId: null }

  const raciWhere = (r: Row, where: Row) =>
    (where.id?.in ? where.id.in.includes(r.id) : true) &&
    (where.documentId === undefined || r.documentId === where.documentId) &&
    (where.letter === undefined || r.letter === where.letter) &&
    (where.removedAt === undefined || (r.removedAt ?? null) === where.removedAt) &&
    (where.submittedAt?.not !== null || r.submittedAt != null)

  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ ...doc })),
      update:     vi.fn(async ({ data }: Row) => Object.assign(doc, data)),
    },
    documentRaci: {
      findMany:   vi.fn(async ({ where }: Row) => raci.filter(r => raciWhere(r, where))),
      findUnique: vi.fn(async ({ where }: Row) => raci.find(r => r.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: Row) => { const hit = raci.filter(r => raciWhere(r, where)); hit.forEach(r => Object.assign(r, data)); return { count: hit.length } }),
    },
    checklistInstanceItem: { findMany: vi.fn(async () => opts.blocking ?? []) },
    project: { findUnique: vi.fn(async () => ({ id: 'p-1', status: 'initiated' })) },
    user:    { findMany: vi.fn(async ({ where }: Row) => (where.id.in as string[]).map(id => ({ id, name: NAMES[id] ?? id }))) },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: Row) => { audit.push(e); return {} }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = current })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()

  const as = (id: string, role: AuthenticatedUser['role'] = 'contributor') => { current = { ...current, id, role } }
  const submit = () => app.inject({ method: 'POST', url: `/documents/${DOC}/submit-for-review`, payload: { dueDate: '2026-11-20' } })
  return { app, doc, raci, audit, as, submit }
}

process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'

describe('submit for review — authors (R) only', () => {
  it.each([
    ['a contributor who is not an author', 'u-rev', 'contributor'],
    ['a PM without an R row', 'u-pm', 'pm'],
    ['a tenant admin', 'u-admin', 'tenant-admin'],
    ['an auditor, even holding R', 'u-aud', 'auditor'],
  ] as const)('%s is refused (403) and nothing changes', async (_l, id, role) => {
    const t = await build({ raci: [rRow('r-a', 'u-a'), rRow('r-aud', 'u-aud')] })
    t.as(id, role)
    const res = await t.submit()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe(role === 'auditor' ? 'auditor_read_only' : 'submit_forbidden')
    expect(t.doc.status).toBe('in_authoring')
    expect(t.raci.every(r => r.submittedAt === null)).toBe(true)
  })

  it('the only author submits → the document goes to review', async () => {
    const t = await build({ raci: [rRow('r-a', 'u-a')] })
    const res = await t.submit()
    expect(res.statusCode).toBe(200)
    expect(t.doc.status).toBe('in_review')
    expect(t.raci[0].submittedAt).toBeInstanceOf(Date)
    expect(t.audit.map(e => e.action)).toEqual(expect.arrayContaining(['document_part_submitted', 'document_submitted_for_review']))
  })

  it('each author submits their own part; the document waits for the last one', async () => {
    const t = await build({ raci: [rRow('r-a', 'u-a', { sectionId: 's1' }), rRow('r-b', 'u-b', { sectionId: 's2' })] })

    const first = await t.submit()                                   // Ann submits her part
    expect(first.statusCode).toBe(202)
    expect(first.json()).toMatchObject({ partSubmitted: true, status: 'in_authoring', pendingAuthors: [{ userId: 'u-b', name: 'Ben Author' }] })
    expect(t.doc.status).toBe('in_authoring')
    expect(t.raci.find(r => r.id === 'r-a')!.submittedAt).toBeInstanceOf(Date)
    expect(t.raci.find(r => r.id === 'r-b')!.submittedAt).toBeNull()  // only her own part

    const again = await t.submit()                                   // re-submitting changes nothing
    expect(again.statusCode).toBe(202)

    t.as('u-b')
    const last = await t.submit()                                    // Ben submits his → review
    expect(last.statusCode).toBe(200)
    expect(t.doc.status).toBe('in_review')
  })

  it('an author holding several section R rows submits all of them as their part', async () => {
    const t = await build({ raci: [rRow('r-a1', 'u-a', { sectionId: 's1' }), rRow('r-a2', 'u-a', { sectionId: 's2' }), rRow('r-b', 'u-b')] })
    await t.submit()
    expect(t.raci.filter(r => r.userId === 'u-a').every(r => r.submittedAt instanceof Date)).toBe(true)
  })

  it('a PM holding R (to sign as author) can submit their part', async () => {
    const t = await build({ raci: [rRow('r-pm', 'u-pm')] })
    t.as('u-pm', 'pm')
    const res = await t.submit()
    expect(res.statusCode).toBe(200)
    expect(t.doc.status).toBe('in_review')
  })

  it('on a document with no R rows yet, its assignee submits alone; otherwise the assignee needs an R row', async () => {
    const solo = await build({ raci: [], assignee: 'u-a' })
    expect((await solo.submit()).statusCode).toBe(200)
    expect(solo.doc.status).toBe('in_review')

    const withAuthors = await build({ raci: [rRow('r-b', 'u-b')], assignee: 'u-a' })
    const res = await withAuthors.submit()                           // u-a is the assignee but holds no R
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('submit_forbidden')
  })

  it('keeps the mandatory-checklist gate: blocked → 409, and the author\'s part is not marked submitted', async () => {
    const t = await build({ raci: [rRow('r-a', 'u-a')], stage: 'study_start_up',
      blocking: [{ id: 'ci-1', text: 'ICF signed', framework: 'ICH', stage: 'study_start_up', ownerRaci: 'R' }] })
    const res = await t.submit()
    expect(res.statusCode).toBe(409)
    expect(JSON.stringify(res.json())).toContain('ICF signed')
    expect(t.raci[0].submittedAt).toBeNull()
    expect(t.doc.status).toBe('in_authoring')
  })
})

describe('no side doors into review', () => {
  it('/transition refuses in_review — even for the author', async () => {
    const t = await build({ raci: [rRow('r-a', 'u-a')] })
    const res = await t.app.inject({ method: 'POST', url: `/documents/${DOC}/transition`, payload: { to: 'in_review' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('use_submit_for_review')
    expect(t.doc.status).toBe('in_authoring')
  })

  it('completing an R row through the RACI routes is refused — authors submit with Submit for review', async () => {
    const t = await build({ raci: [rRow('r-a', 'u-a')] })
    const res = await t.app.inject({ method: 'POST', url: `/documents/${DOC}/raci/r-a/complete`, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('use_submit_for_review')
    expect(t.raci[0].submittedAt).toBeNull()
  })
})

describe('back to authoring starts a new round', () => {
  it('resetAuthorSubmissions clears every active R submission on the document (and only R)', async () => {
    const rows: Row[] = [
      rRow('r-a', 'u-a', { submittedAt: new Date() }),
      rRow('r-old', 'u-b', { submittedAt: new Date(), removedAt: new Date() }),
      { ...rRow('c-1', 'u-rev'), letter: 'C', reviewedAt: new Date() },
    ]
    const updateMany = vi.fn(async ({ where, data }: Row) => {
      const hit = rows.filter(r => r.documentId === where.documentId && r.letter === where.letter && (r.removedAt ?? null) === where.removedAt && r.submittedAt != null)
      hit.forEach(r => Object.assign(r, data))
      return { count: hit.length }
    })
    await resetAuthorSubmissions({ documentRaci: { updateMany } } as never, DOC)
    expect(rows[0].submittedAt).toBeNull()
    expect(rows[1].submittedAt).toBeInstanceOf(Date)        // a removed row keeps its history
    expect(rows[2].reviewedAt).toBeInstanceOf(Date)         // reviewers untouched
  })
})
