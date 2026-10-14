// Regression tests for the invitation sign-in path (AC-PM-007).
//
// The bug these guard against: with the mock SSO, /auth/login always signed
// in as the fixture user (dev@clinwrite.ai), so an invitee who clicked
// "Accept & continue" was signed in as someone else and never activated.
//
// Drives the real auth routes + invitation routes + MockSsoProvider through
// Fastify's inject(), with an in-memory Prisma stub.

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import { beforeEach, describe, expect, it } from 'vitest'
import { authRoutes } from './routes.js'
import { invitationRoutes } from './invitation-routes.js'
import { MockSsoProvider } from './sso.js'
import { generateInvitationToken } from '../modules/platform/users/invitations.js'

type Row = Record<string, any>

function makePrisma(users: Row[], invitations: Row[]) {
  const matchEmail = (u: Row, where: Row) => u.email.toLowerCase() === String(where.email.equals).toLowerCase()
  return {
    users,
    invitations,
    user: {
      findFirst: async ({ where }: Row) => users.find(u => matchEmail(u, where)) ?? null,
      findUnique: async ({ where }: Row) => users.find(u => u.id === where.id) ?? null,
      create: async ({ data }: Row) => { const u = { id: `u${users.length + 1}`, ...data }; users.push(u); return u },
      update: async ({ where, data }: Row) => Object.assign(users.find(u => u.id === where.id)!, data),
    },
    userInvitation: {
      findUnique: async ({ where, include }: Row) => {
        const inv = invitations.find(i => i.tokenHash === where.tokenHash)
        if (!inv) return null
        return include ? { ...inv, user: users.find(u => u.id === inv.userId) } : inv
      },
      update: async ({ where, data }: Row) => Object.assign(invitations.find(i => i.id === where.id)!, data),
    },
    session: { create: async () => ({ id: 'sess-1' }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
}

async function build(users: Row[], invitations: Row[]) {
  const prisma = makePrisma(users, invitations)
  const audit: Row[] = []
  const app = Fastify()
  await app.register(fastifyCookie)
  await app.register(fastifyJwt, { secret: 'x'.repeat(40), cookie: { cookieName: 'aurora_session', signed: false } })
  app.decorate('env', { NODE_ENV: 'development', CORS_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_DOMAIN: '', SSO_PROVIDER: 'mock', JWT_EXPIRY: '1h' } as never)
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: async (e: Row) => { audit.push(e); return { id: '1', rowHash: 'h' } } } as never)
  app.decorate('sso', new MockSsoProvider())
  await app.register(authRoutes)
  await app.register(invitationRoutes)
  return { app, prisma, audit }
}

const cookieHeader = (res: { cookies: Array<{ name: string; value: string }> }, ...names: string[]) =>
  res.cookies.filter(c => names.includes(c.name)).map(c => `${c.name}=${c.value}`).join('; ')

// accept → login → callback, the exact sequence the browser performs.
async function signInThroughInvite(app: FastifyInstance, token: string) {
  const accept = await app.inject({ method: 'POST', url: '/auth/invitations/accept', payload: { token, acceptTerms: true } })
  const inviteCookie = cookieHeader(accept, 'aurora_invite')
  const login = await app.inject({ method: 'GET', url: '/auth/login', headers: { cookie: inviteCookie } })
  const callbackUrl = new URL(login.headers.location as string)
  const callback = await app.inject({
    method: 'GET',
    url: callbackUrl.pathname + callbackUrl.search,
    headers: { cookie: [inviteCookie, cookieHeader(login, 'aurora_sso_state')].filter(Boolean).join('; ') },
  })
  return { accept, login, callback }
}

describe('invitation sign-in', () => {
  const dev = { id: 'dev', email: 'dev@clinwrite.ai', name: 'Dev', role: 'read-only', modules: [], status: 'active', tenantId: null }
  let users: Row[]
  let invitations: Row[]
  let token: string

  beforeEach(() => {
    const t = generateInvitationToken()
    token = t.token
    users = [
      { ...dev },
      { id: 'u-ravi', email: 'ravi@mailinator.com', name: 'ravi', role: 'clinical-writer', modules: ['A'], status: 'invited', tenantId: null },
    ]
    invitations = [{ id: 'inv-1', userId: 'u-ravi', tokenHash: t.tokenHash, expiresAt: t.expiresAt, acceptedAt: null, revokedAt: null }]
  })

  it('signs in AS the invitee (not the mock fixture user) and activates them', async () => {
    const { app } = await build(users, invitations)
    const { login, callback } = await signInThroughInvite(app, token)

    expect(login.headers.location).toContain(encodeURIComponent('mock:ravi@mailinator.com'))
    expect(callback.statusCode).toBe(302)
    expect(users.find(u => u.id === 'u-ravi')).toMatchObject({ status: 'active', termsVersion: '1.0' })
    expect(users.find(u => u.id === 'u-ravi')!.termsAcceptedAt).toBeInstanceOf(Date)
    expect(invitations[0]!.acceptedAt).toBeInstanceOf(Date)
  })

  it('records an audit entry for the acceptance', async () => {
    const { app, audit } = await build(users, invitations)
    await signInThroughInvite(app, token)
    expect(audit.map(a => a.action)).toContain('user.invitation.accept')
  })

  it('works for any invitee, not just one user', async () => {
    const t2 = generateInvitationToken()
    users.push({ id: 'u-tom', email: 'Tom@Mailinator.com', name: 'tom', role: 'reviewer', modules: [], status: 'invited', tenantId: null })
    invitations.push({ id: 'inv-2', userId: 'u-tom', tokenHash: t2.tokenHash, expiresAt: t2.expiresAt, acceptedAt: null, revokedAt: null })
    const { app } = await build(users, invitations)
    await signInThroughInvite(app, t2.token)
    expect(users.find(u => u.id === 'u-tom')!.status).toBe('active')
    expect(users.find(u => u.id === 'u-ravi')!.status).toBe('invited')
  })

  it('without an invite cookie, login does not pick an invitee identity', async () => {
    const { app } = await build(users, invitations)
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    expect(login.headers.location).toContain(encodeURIComponent('mock:dev@clinwrite.ai'))
  })

  it('ignores an attacker-supplied login_hint query parameter', async () => {
    const { app } = await build(users, invitations)
    const login = await app.inject({ method: 'GET', url: '/auth/login?login_hint=ravi@mailinator.com' })
    expect(login.headers.location).toContain(encodeURIComponent('mock:dev@clinwrite.ai'))
  })

  it.each([
    ['expired', (i: Row) => { i.expiresAt = new Date(Date.now() - 1000) }],
    ['revoked', (i: Row) => { i.revokedAt = new Date() }],
    ['already accepted', (i: Row) => { i.acceptedAt = new Date() }],
  ])('a %s invitation is rejected at accept and never activates the user', async (_name, mutate) => {
    mutate(invitations[0]!)
    const { app } = await build(users, invitations)
    const accept = await app.inject({ method: 'POST', url: '/auth/invitations/accept', payload: { token, acceptTerms: true } })
    expect(accept.statusCode).toBe(410)
    expect(users.find(u => u.id === 'u-ravi')!.status).toBe('invited')
  })

  it('requires the terms to be accepted', async () => {
    const { app } = await build(users, invitations)
    const res = await app.inject({ method: 'POST', url: '/auth/invitations/accept', payload: { token, acceptTerms: false } })
    expect(res.statusCode).toBe(400)
  })

  it('refuses an invited user signing in with no invitation (callback)', async () => {
    const { app } = await build(users, invitations)
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    // Force the mock identity to the invitee but with no invite cookie.
    const url = new URL(login.headers.location as string)
    url.searchParams.set('code', 'mock:ravi@mailinator.com')
    const callback = await app.inject({
      method: 'GET', url: url.pathname + url.search,
      headers: { cookie: cookieHeader(login, 'aurora_sso_state') },
    })
    expect(callback.statusCode).toBe(403)
    expect(users.find(u => u.id === 'u-ravi')!.status).toBe('invited')
  })

  it('refuses a token that belongs to a different user (callback)', async () => {
    const { app } = await build(users, invitations)
    const accept = await app.inject({ method: 'POST', url: '/auth/invitations/accept', payload: { token, acceptTerms: true } })
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    const url = new URL(login.headers.location as string)
    // Invitee's cookie, but the signer is a different invited user.
    users.push({ id: 'u-eve', email: 'eve@mailinator.com', name: 'eve', role: 'read-only', modules: [], status: 'invited', tenantId: null })
    url.searchParams.set('code', 'mock:eve@mailinator.com')
    const callback = await app.inject({
      method: 'GET', url: url.pathname + url.search,
      headers: { cookie: [cookieHeader(accept, 'aurora_invite'), cookieHeader(login, 'aurora_sso_state')].join('; ') },
    })
    expect(callback.statusCode).toBe(403)
    expect(users.find(u => u.id === 'u-eve')!.status).toBe('invited')
    expect(users.find(u => u.id === 'u-ravi')!.status).toBe('invited')
  })

  it.each(['suspended', 'deprovisioned'])('a %s user cannot sign back in (status is never auto-reactivated)', async (status) => {
    users.push({ id: 'u-x', email: 'x@mailinator.com', name: 'x', role: 'read-only', modules: [], status, tenantId: null })
    const { app } = await build(users, invitations)
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    const url = new URL(login.headers.location as string)
    url.searchParams.set('code', 'mock:x@mailinator.com')
    const callback = await app.inject({
      method: 'GET', url: url.pathname + url.search,
      headers: { cookie: cookieHeader(login, 'aurora_sso_state') },
    })
    expect(callback.statusCode).toBe(403)
    expect(users.find(u => u.id === 'u-x')!.status).toBe(status)
  })
})
