// External guest magic link, end to end through the real auth plugin, invite / withdraw routes, guest
// redemption routes and comment routes (an in-memory store stands in for the database):
//   - the link opens its own document only — never another document or a project, and it is not a session;
//   - the guest can comment (action table row 15) but cannot resolve (R and A only);
//   - the link expires (14 days by default, or the R's choice) and can be withdrawn by the R.

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fp from 'fastify-plugin'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import authPlugin from '../../../auth/plugin.js'
import { SESSION_COOKIE_NAME } from '../../../auth/jwt.js'
import { commentsRoutes } from '../../clinical-writing/comments/routes.js'
import { guestInvitationRoutes } from './routes.js'
import { guestRedemptionRoutes } from './redemption.js'

const SYSTEM_TOKEN = 'guest-test-system-token-0123456789'
const DAY = 86_400_000
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub

const USERS: Record<string, Row> = {
  'u-r':   { id: 'u-r',   email: 'r@x.io', role: 'contributor', capabilities: [], modules: ['A'], tenantId: 't', status: 'active' },
  'u-out': { id: 'u-out', email: 'o@x.io', role: 'contributor', capabilities: [], modules: ['A'], tenantId: 't', status: 'active' },
}

let saved: { token?: string; bypass?: string }
beforeAll(() => {
  saved = { token: process.env.COLLAB_SYSTEM_TOKEN, bypass: process.env.AUTH_BYPASS_EMAIL }
  process.env.COLLAB_SYSTEM_TOKEN = SYSTEM_TOKEN      // lets the test act as a named user (x-acting-user)
  delete process.env.AUTH_BYPASS_EMAIL               // no fallback identity: the guest must stay anonymous
})
afterAll(() => {
  if (saved.token === undefined) delete process.env.COLLAB_SYSTEM_TOKEN; else process.env.COLLAB_SYSTEM_TOKEN = saved.token
  if (saved.bypass !== undefined) process.env.AUTH_BYPASS_EMAIL = saved.bypass
})
afterEach(() => { vi.useRealTimers() })

async function build() {
  const docs: Row[] = [
    { id: 'D1', projectId: 'P1', title: 'Protocol', type: 'protocol', status: 'in-review', assigneeId: 'u-r', currentVersionId: 'V1', deletedAt: null },
    { id: 'D2', projectId: 'P1', title: 'CSR',      type: 'csr-full', status: 'in-authoring', assigneeId: 'u-r', currentVersionId: 'V2', deletedAt: null },
  ]
  const sections: Row[] = [
    { documentVersionId: 'V1', sectionId: 's1', sectionNumber: '1', sectionTitle: 'Synopsis', contentHtml: '<p>Protocol text.</p>' },
    { documentVersionId: 'V2', sectionId: 's9', sectionNumber: '9', sectionTitle: 'Secret', contentHtml: '<p>CSR text.</p>' },
  ]
  const comments: Row[] = [
    { id: 'CMT-1', documentId: 'D1', sectionRef: '§1', text: 'On the protocol', status: 'open', reviewerId: 'u-r', createdAt: new Date() },
    { id: 'CMT-9', documentId: 'D2', sectionRef: '§9', text: 'On the CSR', status: 'open', reviewerId: 'u-r', createdAt: new Date() },
  ]
  const invites: Row[] = []
  const audit: Row[] = []
  const queriedDocIds = new Set<string>()
  const byDoc = (where: Row) => { if (where?.id) queriedDocIds.add(where.id); return where }

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: Row) => USERS[where.id] ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    session: { findUnique: vi.fn(async () => null) },
    signatureChain: { findFirst: vi.fn(async () => null) },       // no signature chain is running (invites are refused while one is)          // no sessions exist: only the system-token path signs anyone in
    document: {
      findUnique: vi.fn(async ({ where }: Row) => docs.find(d => d.id === byDoc(where).id) ?? null),
      findFirst: vi.fn(async ({ where }: Row) => docs.find(d => d.id === byDoc(where).id && (where.deletedAt === undefined || d.deletedAt === where.deletedAt)) ?? null),
    },
    documentRaci: { findFirst: vi.fn(async ({ where }: Row) => (where.userId === 'u-r' && where.documentId === 'D1' && where.letter === 'R' ? { id: 'raci-r' } : null)) },
    project: { findUnique: vi.fn(async ({ where }: Row) => (where.id === 'P1' ? { id: 'P1' } : null)) },
    guestInvitation: {
      create: vi.fn(async ({ data }: Row) => { const row = { id: `inv-${invites.length + 1}`, documentId: null, projectId: null, invitedAt: new Date(), revokedAt: null, ...data }; invites.push(row); return row }),
      update: vi.fn(async ({ where, data }: Row) => Object.assign(invites.find(i => i.id === where.id)!, data)),
      findUnique: vi.fn(async ({ where }: Row) => invites.find(i => i.id === where.id) ?? null),
      findMany: vi.fn(async () => invites),
    },
    sectionContent: { findMany: vi.fn(async ({ where }: Row) => sections.filter(s => s.documentVersionId === where.documentVersionId)) },
    comment: {
      findMany: vi.fn(async ({ where }: Row) => comments.filter(c => c.documentId === where.documentId)),
      findFirst: vi.fn(async ({ where }: Row) => comments.find(c => c.id === where.id && c.documentId === where.documentId) ?? null),
      create: vi.fn(async ({ data }: Row) => { const row = { createdAt: new Date(), ...data }; comments.push(row); return row }),
      update: vi.fn(),
    },
  }

  const app = Fastify({ maxParamLength: 512 })     // as server.ts: a magic-link token is longer than the default 100
  await app.register(fastifyCookie)
  app.decorate('secrets', { getSecret: async () => 'x'.repeat(40) } as never)
  app.decorate('env', { JWT_EXPIRY: '1h', SSO_PROVIDER: 'mock', NODE_ENV: 'test', EMAIL_FROM: 'n@x', CORS_ORIGIN: 'http://x', SESSION_COOKIE_DOMAIN: '' } as never)
  await app.register(fp(async (a) => { a.decorate('prisma', prisma as never) }, { name: 'prisma' }))
  await app.register(fp(async (a) => { a.decorate('audit', { append: vi.fn(async (e: Row) => { audit.push(e) }) } as never) }, { name: 'audit' }))
  await app.register(authPlugin)
  await app.register(guestInvitationRoutes)
  await app.register(guestRedemptionRoutes, { prefix: '/guest' })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()

  const as = (userId: string) => ({ 'x-system-token': SYSTEM_TOKEN, 'x-acting-user': userId })
  const invite = async (body: Row = { email: 'kol@example.com' }) => {
    const res = await app.inject({ method: 'POST', url: '/documents/D1/guest-invitations', headers: as('u-r'), payload: body })
    expect(res.statusCode).toBe(201)
    return res.json() as { id: string; token: string; expiresAt: string }
  }
  const guest = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Row) => app.inject({ method, url, ...(payload ? { payload } : {}) })
  return { app, prisma, docs, comments, invites, audit, queriedDocIds, as, invite, guest }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })
async function setup() { const t = await build(); current = t.app; return t }

describe('the link opens its own document only', () => {
  it('serves the invited document, its sections and comments — nothing from any other document', async () => {
    const t = await setup()
    const { token } = await t.invite()
    t.queriedDocIds.clear()

    const res = await t.guest('GET', `/guest/document/${token}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.document).toMatchObject({ id: 'D1', title: 'Protocol' })
    expect(body.sections.map((s: Row) => s.sectionId)).toEqual(['s1'])
    expect(body.comments.map((c: Row) => c.id)).toEqual(['CMT-1'])
    expect(JSON.stringify(body)).not.toMatch(/CSR text|On the CSR|D2|P1/)          // no other document, no project id
    expect([...t.queriedDocIds]).toEqual(['D1'])
  })

  it('is not a session: as a cookie or a bearer token it opens nothing else in the app', async () => {
    const t = await setup()
    const { token } = await t.invite()
    for (const url of ['/documents/D2/comments', '/documents/D1/comments']) {
      const asCookie = await t.app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE_NAME]: token } })
      const asBearer = await t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
      expect([asCookie.statusCode, asBearer.statusCode]).toEqual([401, 401])
    }
  })

  it('cannot be pointed at another document: a token whose claims name D2 is refused', async () => {
    const t = await setup()
    const { id } = await t.invite()
    const forged = t.app.jwt.sign({ scope: 'document', documentId: 'D2', email: 'kol@example.com', purpose: 'kol-review', jti: id } as never, { expiresIn: '1d' })
    const res = await t.guest('GET', `/guest/document/${forged}`)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('document_mismatch')
    expect((await t.guest('POST', `/guest/document/${forged}/comments`, { sectionRef: '§9', text: 'x' })).statusCode).toBe(403)
  })

  it('a token signed with another key is refused', async () => {
    const t = await setup()
    const other = Fastify()
    await other.register((await import('@fastify/jwt')).default, { secret: 'y'.repeat(40) })
    await other.ready()
    const bad = other.jwt.sign({ scope: 'document', documentId: 'D1', email: 'kol@example.com', purpose: 'kol-review', jti: 'inv-1' })
    await other.close()
    expect((await t.guest('GET', `/guest/document/${bad}`)).statusCode).toBe(401)
  })

  it('a project-scoped link cannot open or comment on a document', async () => {
    const t = await setup()
    const row = await t.prisma.guestInvitation.create({ data: { scope: 'project', projectId: 'P1', email: 'aud@example.com', purpose: 'external-audit', invitedBy: 'u-admin', expiresAt: new Date(Date.now() + DAY), jwtText: '' } })
    const token = t.app.jwt.sign({ scope: 'project', projectId: 'P1', email: 'aud@example.com', purpose: 'external-audit', jti: row.id } as never, { expiresIn: '1d' })
    expect((await t.guest('GET', `/guest/document/${token}`)).json().error).toBe('scope_mismatch')
    expect((await t.guest('POST', `/guest/document/${token}/comments`, { sectionRef: '§1', text: 'x' })).statusCode).toBe(403)
  })

  it('a deleted document is gone for the guest too: no read, no comment', async () => {
    const t = await setup()
    const { token } = await t.invite()
    t.docs[0]!.deletedAt = new Date()
    expect((await t.guest('GET', `/guest/document/${token}`)).statusCode).toBe(404)
    expect((await t.guest('POST', `/guest/document/${token}/comments`, { sectionRef: '§1', text: 'x' })).statusCode).toBe(404)
    expect(t.comments).toHaveLength(2)
  })
})

describe('the guest can comment (action table row 15) but cannot resolve', () => {
  it('a comment lands on the invited document, open, tagged with the guest email, and is audited', async () => {
    const t = await setup()
    const { token, id } = await t.invite()
    const res = await t.guest('POST', `/guest/document/${token}/comments`, { sectionRef: '§1', text: 'Please cite the dose study.' })
    expect(res.statusCode).toBe(201)
    const created = t.comments.at(-1)!
    expect(created).toMatchObject({ documentId: 'D1', sectionRef: '§1', status: 'open', reviewerId: 'system:guest', externalEmail: 'kol@example.com' })
    expect(t.audit.at(-1)).toMatchObject({ action: 'guest_comment.added', entityId: 'D1', details: { guestInvitationId: id, guestEmail: 'kol@example.com', commentId: created.id } })
  })

  it('an empty comment is refused', async () => {
    const t = await setup()
    const { token } = await t.invite()
    expect((await t.guest('POST', `/guest/document/${token}/comments`, { sectionRef: '§1', text: '' })).statusCode).toBe(400)
  })

  it('cannot resolve: the resolve route refuses the link (cookie or bearer), and the guest API has no resolve', async () => {
    const t = await setup()
    const { token } = await t.invite()
    const body = { resolutionType: 'accept', note: 'done' }
    const asCookie = await t.app.inject({ method: 'PATCH', url: '/documents/D1/comments/CMT-1/resolve', cookies: { [SESSION_COOKIE_NAME]: token }, payload: body })
    const asBearer = await t.app.inject({ method: 'PATCH', url: '/documents/D1/comments/CMT-1/resolve', headers: { authorization: `Bearer ${token}` }, payload: body })
    expect([asCookie.statusCode, asBearer.statusCode]).toEqual([401, 401])
    for (const url of [`/guest/document/${token}/comments/CMT-1/resolve`, `/guest/document/${token}/comments/CMT-1`]) {
      expect((await t.guest('PATCH', url, body)).statusCode).toBe(404)
    }
    expect(t.prisma.comment.update).not.toHaveBeenCalled()
    expect(t.comments.find(c => c.id === 'CMT-1')!.status).toBe('open')
  })
})

describe('expiry', () => {
  it('defaults to 14 days: works on day 13, refused on day 15 with "expired"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-11-05T12:00:00Z')
    vi.setSystemTime(t0)
    const t = await setup()
    const { token, expiresAt } = await t.invite()
    expect(new Date(expiresAt).getTime()).toBe(t0.getTime() + 14 * DAY)
    const exp = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).exp
    expect(exp * 1000).toBe(t0.getTime() + 14 * DAY)

    vi.setSystemTime(t0.getTime() + 13 * DAY)
    expect((await t.guest('GET', `/guest/verify/${token}`)).statusCode).toBe(200)

    vi.setSystemTime(t0.getTime() + 15 * DAY)
    for (const [method, url] of [['GET', `/guest/verify/${token}`], ['GET', `/guest/document/${token}`], ['POST', `/guest/document/${token}/comments`]] as const) {
      const res = await t.guest(method, url, method === 'POST' ? { sectionRef: '§1', text: 'late' } : undefined)
      expect(res.statusCode).toBe(401)
      expect(res.json().message).toBe('This link has expired. Request a new one.')
    }
    expect(t.comments).toHaveLength(2)
  })

  it('the R can choose the length (1–90 days); outside that is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-11-05T12:00:00Z')
    vi.setSystemTime(t0)
    const t = await setup()
    const { token } = await t.invite({ email: 'kol@example.com', expiresInDays: 3 })
    vi.setSystemTime(t0.getTime() + 4 * DAY)
    expect((await t.guest('GET', `/guest/document/${token}`)).statusCode).toBe(401)
    for (const expiresInDays of [0, 91]) {
      const res = await t.app.inject({ method: 'POST', url: '/documents/D1/guest-invitations', headers: t.as('u-r'), payload: { email: 'kol@example.com', expiresInDays } })
      expect(res.statusCode).toBe(400)
    }
  })

  it('the stored expiry also counts: a link past it is refused (410) even if the token itself is still valid', async () => {
    const t = await setup()
    const { token, id } = await t.invite()
    t.invites.find(i => i.id === id)!.expiresAt = new Date(Date.now() - 1000)
    const res = await t.guest('GET', `/guest/document/${token}`)
    expect(res.statusCode).toBe(410)
    expect(res.json().error).toBe('expired')
  })
})

describe('withdraw', () => {
  it('the R withdraws the link: every guest endpoint then answers 410 "revoked", and it is audited', async () => {
    const t = await setup()
    const { token, id } = await t.invite()
    expect((await t.guest('GET', `/guest/document/${token}`)).statusCode).toBe(200)

    const res = await t.app.inject({ method: 'DELETE', url: `/guest-invitations/${id}`, headers: t.as('u-r') })
    expect(res.statusCode).toBe(200)
    expect(res.json().revokedAt).toEqual(expect.any(String))
    expect(res.json().token).toBeUndefined()                                   // the link is never handed out again
    expect(t.audit.at(-1)).toMatchObject({ action: 'guest_invitation.revoked', entityId: 'D1', details: { guestInvitationId: id, email: 'kol@example.com' } })

    for (const [method, url] of [['GET', `/guest/verify/${token}`], ['GET', `/guest/document/${token}`], ['POST', `/guest/document/${token}/comments`]] as const) {
      const r = await t.guest(method, url, method === 'POST' ? { sectionRef: '§1', text: 'after withdraw' } : undefined)
      expect(r.statusCode).toBe(410)
      expect(r.json().error).toBe('revoked')
    }
    expect(t.comments).toHaveLength(2)
  })

  it('withdrawing twice is a conflict; someone who is not the R (or an admin) cannot withdraw', async () => {
    const t = await setup()
    const { id } = await t.invite()
    const outsider = await t.app.inject({ method: 'DELETE', url: `/guest-invitations/${id}`, headers: t.as('u-out') })
    expect(outsider.statusCode).toBe(403)
    expect((await t.app.inject({ method: 'DELETE', url: `/guest-invitations/${id}`, headers: t.as('u-r') })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'DELETE', url: `/guest-invitations/${id}`, headers: t.as('u-r') })).statusCode).toBe(409)
  })

  it('withdrawing one guest leaves another guest’s link on the same document working', async () => {
    const t = await setup()
    const a = await t.invite({ email: 'kol-a@example.com' })
    const b = await t.invite({ email: 'kol-b@example.com' })
    await t.app.inject({ method: 'DELETE', url: `/guest-invitations/${a.id}`, headers: t.as('u-r') })
    expect((await t.guest('GET', `/guest/document/${a.token}`)).statusCode).toBe(410)
    expect((await t.guest('GET', `/guest/document/${b.token}`)).statusCode).toBe(200)
  })
})
