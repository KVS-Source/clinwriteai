// CRM resolve + complete gate: resolving a comment via POST, and the rule
// that reviewer "approve" verdicts don't block completing the meeting while
// real comments still do. Fastify inject() over an in-memory Prisma double.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { crmRoutes } from './routes.js'

type Row = Record<string, any>

function fakePrisma() {
  const documents: Row[] = [{ id: 'DOC-1', status: 'crm_in_progress', projectId: 'P-1', assigneeId: 'someone-else' }]
  const raci: Row[] = [{ documentId: 'DOC-1', userId: 'u-chair', letter: 'R' }]
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
      create: async ({ data }: Row) => { const m = { id: `m${meetings.length + 1}`, status: 'scheduled', ...data }; meetings.push(m); return m },
    },
    crmAttendee: { createMany: async () => ({ count: 1 }) },
    $queryRawUnsafe: async () => [{ meetingRef: 'CRM-001' }],
    comment: {
      findUnique: async ({ where }: Row) => comments.find(c => c.id === where.id) ?? null,
      findMany: async ({ where }: Row) => comments.filter(c => matches(c, where)),
      update: async ({ where, data }: Row) => Object.assign(comments.find(c => c.id === where.id)!, data),
    },
    crmResolution: {
      create: async ({ data }: Row) => { const r = { id: `r${resolutions.length + 1}`, ...data }; resolutions.push(r); return r },
    },
    documentRaci: {
      findMany: async ({ where }: Row) => raci.filter(r =>
        r.userId === where.userId
        && (where.documentId?.in ? where.documentId.in.includes(r.documentId) : r.documentId === where.documentId)
        && (!where.letter || where.letter.in.includes(r.letter))),
    },
    projectMember:     { findMany: async () => [{ projectId: 'P-1' }] },
    projectTeamMember: { findMany: async () => [] },
    document: {
      findUnique: async ({ where }: Row) => documents.find(d => d.id === where.id) ?? null,
      findMany: async () => [],
      updateMany: async ({ where, data }: Row) => {
        const hit = documents.filter(d => matches(d, where)); hit.forEach(d => Object.assign(d, data)); return { count: hit.length }
      },
    },
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, meetings, comments, raci }
}

async function build(user: Row = {}) {
  const db = fakePrisma()
  const app = Fastify()
  app.decorate('prisma', db.prisma as never)
  app.decorate('audit', { append: async () => ({ id: '1', rowHash: 'h' }) } as never)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: Row }).user = { id: 'u-chair', email: 'c@x.test', role: 'clinical-writer', modules: ['A'], tenantId: null, ...user }
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

describe('who may schedule and resolve', () => {
  const schedule = (app: Awaited<ReturnType<typeof build>>['app']) => app.inject({
    method: 'POST', url: '/documents/DOC-1/crm',
    payload: { chairId: 'u-pm', scheduledDate: '2026-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
  })

  it('refuses QC and an admin, and says so on the access probe', async () => {
    for (const [user, letter] of [[{ id: 'u-qc', role: 'contributor' }, 'Q'], [{ id: 'u-ta', role: 'tenant-admin' }, 'R']] as const) {
      const { app, db } = await build(user)
      db.documents[0]!.status = 'in_review'
      db.raci.push({ documentId: 'DOC-1', userId: user.id, letter })
      const before = db.meetings.length
      const res = await schedule(app)
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('crm_schedule_forbidden')
      expect(db.meetings).toHaveLength(before)
      expect((await app.inject({ method: 'GET', url: '/documents/DOC-1/crm/access' })).json()).toEqual({ canSchedule: false })
    }
  })

  it('lets an Informed (I) participant schedule', async () => {
    const { app, db } = await build({ id: 'u-i', role: 'contributor' })
    db.documents[0]!.status = 'in_review'
    db.raci.push({ documentId: 'DOC-1', userId: 'u-i', letter: 'I' })
    expect((await schedule(app)).statusCode).toBe(201)
  })

  it('refuses a resolution from QC, Informed, or a chair with no R, C or A', async () => {
    for (const letter of ['Q', 'I', null]) {
      const { app, db } = await build({ id: 'u-x', role: 'pm' })
      db.meetings[0]!.chairId = 'u-x'
      if (letter) db.raci.push({ documentId: 'DOC-1', userId: 'u-x', letter })
      db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })
      const res = await app.inject({
        method: 'POST', url: '/crm/m1/resolve',
        payload: { commentId: 'c-real', resolutionType: 'accept', resolutionNote: 'Agreed' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('comment_resolve_forbidden')
      expect(db.comments[0].status).toBe('open')
    }
  })
})

describe('a project manager running a CRM', () => {
  it('schedules, starts and completes the meeting they chair, with a reviewer resolving the comment', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_review'
    db.meetings.length = 0
    db.raci.push({ documentId: 'DOC-1', userId: 'u-pm', letter: 'C' })
    db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })

    const scheduled = await app.inject({
      method: 'POST', url: '/documents/DOC-1/crm',
      payload: { chairId: 'u-pm', scheduledDate: '2026-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
    })
    expect(scheduled.statusCode).toBe(201)
    const id = scheduled.json().id

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/start` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('crm_in_progress')

    const resolved = await app.inject({
      method: 'POST', url: `/crm/${id}/resolve`,
      payload: { commentId: 'c-real', resolutionType: 'accept', resolutionNote: 'Agreed' },
    })
    expect(resolved.statusCode).toBeLessThan(300)

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/complete` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('pending_signature')
  })

  it('cannot start or complete a meeting someone else chairs', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    expect((await app.inject({ method: 'POST', url: '/crm/m1/complete' })).statusCode).toBe(403)
    db.meetings[0]!.status = 'scheduled'
    const started = await app.inject({ method: 'POST', url: '/crm/m1/start' })
    expect(started.statusCode).toBe(403)
    expect(started.json().error).toBe('only_chair')
    expect(db.meetings[0]!.status).toBe('scheduled')
  })
})
