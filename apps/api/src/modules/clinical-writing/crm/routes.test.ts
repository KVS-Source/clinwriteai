// CRM resolve + complete gate: resolving a comment via POST, and the rule
// that reviewer "approve" verdicts don't block completing the meeting while
// real comments still do. Fastify inject() over an in-memory Prisma double.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { crmRoutes } from './routes.js'

type Row = Record<string, any>

function fakePrisma() {
  const documents: Row[] = [{ id: 'DOC-1', status: 'crm_in_progress' }]
  const meetings: Row[] = [{ id: 'm1', documentId: 'DOC-1', chairId: 'u-chair', status: 'in_progress', meetingRef: 'CRM-1' }]
  const comments: Row[] = []
  const resolutions: Row[] = []
  // Minimal where-matcher: equality, { not }, OR, null.
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some(w => matches(row, w))
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== null && row[k] !== undefined && row[k] !== v.not
    return v === null ? row[k] === null || row[k] === undefined : row[k] === v
  })
  const prisma: Row = {
    crmMeeting: {
      findUnique: async ({ where, include }: Row) => {
        const m = meetings.find(x => x.id === where.id)
        return m && include?.resolutions ? { ...m, resolutions: resolutions.filter(r => r.meetingId === m.id) } : m ?? null
      },
      update: async ({ where, data }: Row) => Object.assign(meetings.find(m => m.id === where.id)!, data),
    },
    comment: {
      findUnique: async ({ where }: Row) => comments.find(c => c.id === where.id) ?? null,
      findMany: async ({ where }: Row) => comments.filter(c => matches(c, where)),
      update: async ({ where, data }: Row) => Object.assign(comments.find(c => c.id === where.id)!, data),
    },
    crmResolution: {
      create: async ({ data }: Row) => { const r = { id: `r${resolutions.length + 1}`, ...data }; resolutions.push(r); return r },
    },
    document: {
      updateMany: async ({ where, data }: Row) => {
        const hit = documents.filter(d => matches(d, where)); hit.forEach(d => Object.assign(d, data)); return { count: hit.length }
      },
    },
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, comments }
}

async function build() {
  const db = fakePrisma()
  const app = Fastify()
  app.decorate('prisma', db.prisma as never)
  app.decorate('audit', { append: async () => ({ id: '1', rowHash: 'h' }) } as never)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: Row }).user = { id: 'u-chair', email: 'c@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null }
  })
  await app.register(crmRoutes)
  return { app, db }
}

describe('CRM resolve + complete', () => {
  let t: Awaited<ReturnType<typeof build>>
  beforeEach(async () => { t = await build() })

  it('completes the meeting when the only open comments are approval verdicts → pending_signature', async () => {
    t.db.comments.push({ id: 'c-approve', documentId: 'DOC-1', status: 'open', verdict: 'approve' })
    const res = await t.app.inject({ method: 'POST', url: '/crm/m1/complete' })
    expect(res.statusCode).toBe(200)
    expect(t.db.documents[0].status).toBe('pending_signature')
  })

  it('still blocks completion while a real comment is unresolved', async () => {
    t.db.comments.push(
      { id: 'c-approve', documentId: 'DOC-1', status: 'open', verdict: 'approve' },
      { id: 'c-real',    documentId: 'DOC-1', status: 'open', verdict: null },
      { id: 'c-changes', documentId: 'DOC-1', status: 'open', verdict: 'request_changes' },
    )
    const res = await t.app.inject({ method: 'POST', url: '/crm/m1/complete' })
    expect(res.statusCode).toBe(422)
    expect(res.json().unresolvedCommentIds.sort()).toEqual(['c-changes', 'c-real'])
    expect(t.db.documents[0].status).toBe('crm_in_progress')
  })

  it('resolves a comment via POST with resolutionNote, after which the meeting can complete', async () => {
    t.db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })
    const resolve = await t.app.inject({
      method: 'POST', url: '/crm/m1/resolve',
      payload: { commentId: 'c-real', resolutionType: 'accept', resolutionNote: 'Agreed — wording updated' },
    })
    expect(resolve.statusCode).toBeLessThan(300)
    expect(t.db.comments[0].status).toBe('resolved')

    const done = await t.app.inject({ method: 'POST', url: '/crm/m1/complete' })
    expect(done.statusCode).toBe(200)
    expect(t.db.documents[0].status).toBe('pending_signature')
  })

  it('rejects a resolution without a note (Part 11 audit)', async () => {
    t.db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })
    const res = await t.app.inject({ method: 'POST', url: '/crm/m1/resolve', payload: { commentId: 'c-real', resolutionType: 'accept', resolutionNote: '' } })
    expect(res.statusCode).toBe(400)
  })
})
