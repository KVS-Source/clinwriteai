// CRM resolve + complete gate: resolving a comment via POST, and the rule
// that reviewer "approve" verdicts don't block completing the meeting while
// real comments still do. Fastify inject() over an in-memory Prisma double.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { crmRoutes } from './routes.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma double
type Row = Record<string, any>

function fakePrisma() {
  const documents: Row[] = [{ id: 'DOC-1', status: 'crm_in_progress', projectId: 'P-1', assigneeId: 'someone-else' }]
  const raci: Row[] = [{ documentId: 'DOC-1', userId: 'u-chair', letter: 'R' }]
  const meetings: Row[] = [{ id: 'm1', documentId: 'DOC-1', chairId: 'u-chair', status: 'in_progress', meetingRef: 'CRM-1' }]
  const comments: Row[] = []
  const resolutions: Row[] = []
  const attendees: Row[] = []
  // The people the CRM can draw on: the PM and the document's own letters. u-ta is an admin, u-aud an auditor.
  const users: Row[] = [
    { id: 'u-pm', name: 'Priya PM', initials: 'PP', role: 'pm' }, { id: 'u-chair', name: 'Cora Author', initials: null, role: 'contributor' },
    { id: 'u-c', name: 'Rhea Reviewer', initials: 'RR', role: 'contributor' }, { id: 'u-qc', name: 'Quinn QC', initials: 'QQ', role: 'contributor' },
    { id: 'u-i', name: 'Ira Informed', initials: 'II', role: 'contributor' }, { id: 'u-ta', name: 'Tia Admin', initials: 'TA', role: 'tenant-admin' },
    { id: 'u-out', name: 'Olly Outsider', initials: 'OO', role: 'contributor' },
    { id: 'u-pm2', name: 'Pia Other-PM', initials: 'PO', role: 'pm' },   // a PM who can see the project but is not listed as a member
  ]
  // Minimal where-matcher: equality, { not }, { in }, OR, null.
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some(w => matches(row, w))
    if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k])
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
      count: async ({ where }: Row) => meetings.filter(m => matches(m, where)).length,
      create: async ({ data }: Row) => { const m = { id: `m${meetings.length + 1}`, status: 'scheduled', ...data }; meetings.push(m); return m },
    },
    crmAttendee: {
      createMany: async ({ data }: Row) => { attendees.push(...data); return { count: data.length } },
      upsert: async ({ create }: Row) => { attendees.push(create); return create },
      findFirst: async ({ where }: Row) => attendees.find(a => a.meetingId === where.meetingId && a.userId === where.userId) ?? null,
    },
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
        (where.userId === undefined || r.userId === where.userId)
        && (where.documentId?.in ? where.documentId.in.includes(r.documentId) : r.documentId === where.documentId)
        && (!where.letter || where.letter.in.includes(r.letter))),
      findFirst: async ({ where }: Row) => raci.find(r =>
        r.documentId === where.documentId && r.userId === where.userId && (!where.letter || where.letter.in.includes(r.letter))) ?? null,
    },
    user: { findMany: async ({ where }: Row) => users.filter(u => where.id.in.includes(u.id) && !(where.role?.notIn ?? []).includes(u.role)) },
    projectMember:     { findMany: async () => [{ projectId: 'P-1', userId: 'u-pm', user: { role: 'pm' } }] },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: async () => [] },
    project: { findUnique: async () => ({ status: 'ongoing' }) },

    document: {

      count: async () => 1,
      findUnique: async ({ where }: Row) => documents.find(d => d.id === where.id) ?? null,
      findMany: async () => [],
      updateMany: async ({ where, data }: Row) => {
        const hit = documents.filter(d => matches(d, where)); hit.forEach(d => Object.assign(d, data)); return { count: hit.length }
      },
    },
    $transaction: async (fn: (tx: Row) => unknown) => fn(prisma),
  }
  return { prisma, documents, meetings, comments, raci, attendees }
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

describe('comment text in a CRM meeting', () => {
  it.each(['tenant-admin', 'admin', 'super-admin'])('is refused to a %s: resolutions, AI drafts and minutes', async (role) => {
    const { app } = await build({ id: 'u-ta', role })
    for (const [method, url] of [['GET', '/crm/m1/resolutions'], ['GET', '/crm/m1/ai-drafts'], ['POST', '/crm/m1/minutes']] as const) {
      const res = await app.inject({ method, url })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error).toBe('comment_view_forbidden')
    }
  })
})

describe('who may schedule and resolve', () => {
  const schedule = (app: Awaited<ReturnType<typeof build>>['app']) => app.inject({
    method: 'POST', url: '/documents/DOC-1/crm',
    payload: { chairId: 'u-pm', scheduledDate: '2099-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
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

  it('lets the Author, Reviewer and Approver schedule, but not an Informed (I) person (participant only)', async () => {
    for (const [letter, expected] of [['R', 201], ['C', 201], ['A', 201], ['I', 403]] as const) {
      const { app, db } = await build({ id: 'u-x', role: 'contributor' })
      db.documents[0]!.status = 'in_review'
      db.raci.push({ documentId: 'DOC-1', userId: 'u-x', letter })
      expect((await schedule(app)).statusCode, letter).toBe(expected)
    }
  })

  it('refuses a resolution from QC or Informed', async () => {
    for (const letter of ['Q', 'I']) {
      const { app, db } = await build({ id: 'u-x', role: 'contributor' })
      db.raci.push({ documentId: 'DOC-1', userId: 'u-x', letter })
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

  it('refuses a resolution from a PM chairing the meeting, whatever letter they hold', async () => {
    for (const letter of ['R', 'C', 'A', null]) {
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
  it('schedules, starts and completes the meeting they chair, once a reviewer has resolved the comment', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_review'
    db.meetings.length = 0
    db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })

    const scheduled = await app.inject({
      method: 'POST', url: '/documents/DOC-1/crm',
      payload: { chairId: 'u-pm', scheduledDate: '2099-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
    })
    expect(scheduled.statusCode).toBe(201)
    const id = scheduled.json().id

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/start` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('crm_in_progress')

    // The chair can't close it over an open comment, and can't resolve it themselves.
    expect((await app.inject({ method: 'POST', url: `/crm/${id}/complete` })).statusCode).toBe(422)
    db.comments[0]!.status = 'resolved'

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/complete` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('pending_signature')
  })

  it('a meeting held during authoring puts the document back in authoring when it completes', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_authoring'
    db.meetings.length = 0

    const scheduled = await app.inject({
      method: 'POST', url: '/documents/DOC-1/crm',
      payload: { chairId: 'u-pm', scheduledDate: '2099-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
    })
    expect(scheduled.statusCode).toBe(201)
    const id = scheduled.json().id

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/start` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('crm_in_progress')
    expect(db.meetings[0]!.returnToStatus).toBe('in_authoring')

    expect((await app.inject({ method: 'POST', url: `/crm/${id}/complete` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('in_authoring')   // as it was, not on to signature
  })

  it('cancelling a meeting held during authoring also goes back to authoring', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_authoring'
    db.meetings.length = 0
    const id = (await app.inject({
      method: 'POST', url: '/documents/DOC-1/crm',
      payload: { chairId: 'u-pm', scheduledDate: '2099-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
    })).json().id
    await app.inject({ method: 'POST', url: `/crm/${id}/start` })
    expect((await app.inject({ method: 'POST', url: `/crm/${id}/cancel` })).statusCode).toBe(200)
    expect(db.documents[0]!.status).toBe('in_authoring')
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

describe('scheduling a CRM meeting', () => {
  it('refuses a date already passed, and schedules nothing', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_review'
    db.raci.push({ documentId: 'DOC-1', userId: 'u-pm', letter: 'R' })
    const before = db.meetings.length
    const res = await app.inject({
      method: 'POST', url: '/documents/DOC-1/crm',
      payload: { chairId: 'u-pm', scheduledDate: '2025-01-01T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [] },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('date_in_past')
    expect(db.meetings).toHaveLength(before)
  })
})

describe('who can be in a meeting (CW-014, CW-098)', () => {
  const people = (db: Awaited<ReturnType<typeof build>>['db']) => {
    db.raci.push(
      { documentId: 'DOC-1', userId: 'u-c', letter: 'C' }, { documentId: 'DOC-1', userId: 'u-qc', letter: 'Q' },
      { documentId: 'DOC-1', userId: 'u-i', letter: 'I' }, { documentId: 'DOC-1', userId: 'u-ta', letter: 'R' },
    )
  }
  const schedule = (app: Awaited<ReturnType<typeof build>>['app'], payload: Record<string, unknown>) => app.inject({
    method: 'POST', url: '/documents/DOC-1/crm',
    payload: { chairId: 'u-pm', scheduledDate: '2099-11-10T09:00:00.000Z', startTime: '09:00', endTime: '10:00', attendees: [], ...payload },
  })

  it('lists the document\'s people and the PM, never an admin or an outsider, with who can chair', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    people(db)
    const res = await app.inject({ method: 'GET', url: '/documents/DOC-1/crm/people' })
    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(res.json().map((p: { id: string }) => [p.id, p]))
    expect(Object.keys(byId).sort()).toEqual(['u-c', 'u-chair', 'u-i', 'u-pm', 'u-qc'])   // no u-ta (admin), no u-out
    expect(byId['u-pm']).toMatchObject({ isPm: true, canChair: true })
    expect(byId['u-chair']).toMatchObject({ letters: ['R'], canChair: true })
    expect(byId['u-c'].canChair).toBe(true)
    expect(byId['u-qc'].canChair).toBe(false)
    expect(byId['u-i'].canChair).toBe(false)
  })

  it('a PM who is not a listed project member can still chair the meeting they schedule', async () => {
    const { app, db } = await build({ id: 'u-pm2', role: 'pm' })
    db.documents[0]!.status = 'in_review'; people(db)
    const list = (await app.inject({ method: 'GET', url: '/documents/DOC-1/crm/people' })).json()
    expect(list.find((p: { id: string }) => p.id === 'u-pm2')).toMatchObject({ isPm: true, canChair: true })
    expect((await schedule(app, { chairId: 'u-pm2' })).statusCode).toBe(201)
  })

  it('is only for people who may schedule', async () => {
    const { app, db } = await build({ id: 'u-i', role: 'contributor' })
    db.raci.push({ documentId: 'DOC-1', userId: 'u-i', letter: 'I' })
    expect((await app.inject({ method: 'GET', url: '/documents/DOC-1/crm/people' })).statusCode).toBe(403)
  })

  it('schedules with a PM, Author, Reviewer or Approver as chair and the document\'s people as attendees', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_review'; people(db)
    const res = await schedule(app, { chairId: 'u-c', attendees: [{ userId: 'u-i', roleInCrm: 'Observer' }, { userId: 'u-qc', roleInCrm: 'Reviewer' }] })
    expect(res.statusCode).toBe(201)
    expect(db.attendees.map(a => a.userId).sort()).toEqual(['u-c', 'u-i', 'u-qc'])
  })

  it.each([
    ['QC (Q) as chair', { chairId: 'u-qc' }],
    ['an Informed (I) person as chair', { chairId: 'u-i' }],
    ['someone who is not on the document as chair', { chairId: 'u-out' }],
    ['an admin as chair', { chairId: 'u-ta' }],
    ['someone who is not on the document as an attendee', { attendees: [{ userId: 'u-out', roleInCrm: 'Reviewer' }] }],
  ])('refuses %s, and schedules nothing', async (_what, payload) => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' })
    db.documents[0]!.status = 'in_review'; people(db)
    const before = db.meetings.length
    const res = await schedule(app, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('crm_people_invalid')
    expect(db.meetings).toHaveLength(before)
  })

  it('adding an attendee later: for the chair and schedulers, with the same people only', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' }); people(db); db.meetings[0]!.status = 'scheduled'
    const add = (userId: string, roleInCrm = 'Observer') => app.inject({ method: 'POST', url: '/crm/m1/attendees', payload: { userId, roleInCrm } })
    expect((await add('u-i')).statusCode).toBe(201)
    expect((await add('u-out')).statusCode).toBe(400)
    expect((await add('u-qc', 'Chair')).statusCode).toBe(400)
  })

  it('an Informed (I) or QC (Q) person cannot add attendees', async () => {
    for (const [id, letter] of [['u-i', 'I'], ['u-qc', 'Q']] as const) {
      const { app, db } = await build({ id, role: 'contributor' }); people(db); db.meetings[0]!.status = 'scheduled'
      const res = await app.inject({ method: 'POST', url: '/crm/m1/attendees', payload: { userId: 'u-c', roleInCrm: 'Reviewer' } })
      expect(res.statusCode, letter).toBe(403)
      expect(res.json().error).toBe(letter === 'I' ? 'informed_read_only' : 'crm_schedule_forbidden')
    }
  })

  it('an Informed (I) participant can log a resolution, one who was not invited cannot', async () => {
    for (const [invited, expected] of [[true, 201], [false, 403]] as const) {
      const { app, db } = await build({ id: 'u-i', role: 'contributor' }); people(db)
      db.comments.push({ id: 'c-real', documentId: 'DOC-1', status: 'open', verdict: null })
      if (invited) db.attendees.push({ meetingId: 'm1', userId: 'u-i', roleInCrm: 'Observer' })
      const res = await app.inject({ method: 'POST', url: '/crm/m1/resolve', payload: { commentId: 'c-real', resolutionType: 'accept', resolutionNote: 'Agreed' } })
      expect(res.statusCode, String(invited)).toBe(expected)
    }
  })

  it('shows each person\'s part in the meeting (not their platform role) and always has initials', async () => {
    const { app, db } = await build({ id: 'u-pm', role: 'pm' }); people(db)
    db.attendees.push({ meetingId: 'm1', userId: 'u-chair', roleInCrm: 'Chair' }, { meetingId: 'm1', userId: 'u-i', roleInCrm: 'Observer' })
    db.meetings[0]!.createdAt = new Date()
    Object.assign(db.meetings[0]!, { scheduledDate: new Date(), startTime: '09:00', endTime: '10:00' })
    // the list route builds the shape from the meeting + its attendees
    const prisma = db.prisma as Row
    prisma.crmMeeting.findMany = async () => [{ ...db.meetings[0], attendees: db.attendees.filter(a => a.meetingId === 'm1'), resolutions: [] }]
    const res = await app.inject({ method: 'GET', url: '/documents/DOC-1/crm' })
    expect(res.statusCode).toBe(200)
    const meeting = res.json()[0] ?? res.json()
    expect(meeting.chair).toMatchObject({ name: 'Cora Author', role: 'Chair', initials: 'CA' })
    expect(meeting.attendees.map((a: { role: string }) => a.role).sort()).toEqual(['Chair', 'Observer'])
    expect(meeting.attendees.every((a: { initials: string }) => a.initials)).toBe(true)
  })
})
