// Regression tests for first-party invite registration (POST /auth/invitations/register).
//
// The invitee sets their own password from the one-time link, which activates
// the account (invited → active) and records the T&C — no SSO required. Drives
// the real invitation routes through Fastify inject() with an in-memory Prisma
// stub.

import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { beforeEach, describe, expect, it } from 'vitest'
import { invitationRoutes } from './invitation-routes.js'
import { verifyPassword } from './password.js'
import { generateInvitationToken } from '../modules/platform/users/invitations.js'

type Row = Record<string, any>
const STRONG = 'Str0ng!Passw0rd'

function makePrisma(users: Row[], invitations: Row[]) {
  return {
    users,
    invitations,
    user: {
      findUnique: async ({ where }: Row) => users.find(u => u.id === where.id) ?? null,
      update: async ({ where, data }: Row) => Object.assign(users.find(u => u.id === where.id)!, data),
    },
    userInvitation: {
      findUnique: async ({ where, include }: Row) => {
        const inv = invitations.find(i => i.tokenHash === where.tokenHash)
        if (!inv) return null
        return include ? { ...inv, user: users.find(u => u.id === inv.userId) } : inv
      },
      update: async ({ where, data }: Row) => Object.assign(invitations.find(i => i.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        let count = 0
        for (const i of invitations) {
          if (i.userId === where.userId && i.acceptedAt == null && i.revokedAt == null && i.id !== where.id?.not) {
            Object.assign(i, data); count++
          }
        }
        return { count }
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
}

async function build(users: Row[], invitations: Row[]) {
  const prisma = makePrisma(users, invitations)
  const audit: Row[] = []
  const app = Fastify()
  await app.register(fastifyCookie)
  app.decorate('env', { NODE_ENV: 'development', CORS_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_DOMAIN: '' } as never)
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: async (e: Row) => { audit.push(e); return { id: '1', rowHash: 'h' } } } as never)
  await app.register(invitationRoutes)
  return { app, prisma, audit, users, invitations }
}

function seed() {
  const { token, tokenHash, expiresAt } = generateInvitationToken()
  const users = [{ id: 'u1', email: 'ravi@acme.com', name: 'Ravi', role: 'contributor', status: 'invited', passwordHash: null }]
  const invitations = [{ id: 'inv1', userId: 'u1', tokenHash, expiresAt, acceptedAt: null, revokedAt: null }]
  return { token, users, invitations }
}

describe('POST /auth/invitations/register', () => {
  let ctx: Awaited<ReturnType<typeof build>>
  let token: string

  beforeEach(async () => {
    const s = seed()
    token = s.token
    ctx = await build(s.users, s.invitations)
  })

  it('activates the account, stores the chosen password, and consumes the token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token, newPassword: STRONG, acceptTerms: true } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, email: 'ravi@acme.com' })

    const user = ctx.users[0]
    expect(user.status).toBe('active')
    expect(user.mustChangePassword).toBe(false)
    expect(user.termsAcceptedAt).toBeInstanceOf(Date)
    expect(typeof user.passwordHash).toBe('string')
    expect(await verifyPassword(STRONG, user.passwordHash)).toBe(true)   // the password they set actually works
    expect(ctx.invitations[0].acceptedAt).toBeInstanceOf(Date)           // one-time token consumed
    expect(ctx.audit.at(-1)).toMatchObject({ action: 'user.invitation.register' })
  })

  it('rejects a weak password and changes nothing', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token, newPassword: 'weak', acceptTerms: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('password_policy')
    expect(ctx.users[0].status).toBe('invited')
    expect(ctx.users[0].passwordHash).toBeNull()
    expect(ctx.invitations[0].acceptedAt).toBeNull()
  })

  it('requires the terms to be accepted', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token, newPassword: STRONG, acceptTerms: false } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/terms/i)
    expect(ctx.users[0].status).toBe('invited')
  })

  it('refuses a reused (already-accepted) link', async () => {
    const first = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token, newPassword: STRONG, acceptTerms: true } })
    expect(first.statusCode).toBe(200)
    const second = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token, newPassword: STRONG, acceptTerms: true } })
    expect(second.statusCode).toBe(410)
    expect(second.json().reason).toBe('accepted')
  })

  it('refuses an unknown token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/invitations/register', payload: { token: 'x'.repeat(40), newPassword: STRONG, acceptTerms: true } })
    expect(res.statusCode).toBe(410)
  })
})
