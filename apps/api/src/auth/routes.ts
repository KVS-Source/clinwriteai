// Auth routes — login, callback, logout, me.
//
// Flow (mock + WorkOS identical):
//   1. GET /auth/login             → 302 to SSO authorize URL (opaque state cookie set)
//   2. GET /auth/callback?code=... → exchanges code → upserts User + inserts Session
//                                  → sets session cookie → 302 to /
//   3. POST /auth/logout           → revokes Session, clears cookie
//   4. GET /auth/me                → returns the authenticated user (RBAC gate)
//
// State is a short random string tied to a one-shot cookie — defends against
// cross-site callback forgery (CSRF-on-the-SSO-return path).

import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { SESSION_COOKIE_NAME, type SessionClaims } from './jwt.js'
import { requireAuth, type ModuleKey, type Role } from './rbac.js'

const SSO_STATE_COOKIE = 'aurora_sso_state'
const SSO_STATE_TTL_SECONDS = 10 * 60

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/login', async (request, reply) => {
    const state = randomBytes(16).toString('hex')
    reply.setCookie(SSO_STATE_COOKIE, state, {
      httpOnly: true,
      secure: app.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/',
      maxAge: SSO_STATE_TTL_SECONDS,
    })
    // Callback must land on THIS host (the API) — /auth/callback is a
    // Fastify route, not a SPA route. Earlier incarnations constructed
    // this from CORS_ORIGIN (the frontend host) which caused the mock
    // SSO to redirect to demo.clinwrite.ai/auth/callback → SPA 404
    // fallthrough to / → fetch /projects → 401 → /auth/login → infinite
    // bounce (observed in prod as a flashing refresh + /projects 429s
    // from rate-limit tripping on the retry storm).
    const redirectUri = resolveRedirectUri(request)
    const url = await app.sso.getAuthorizationUrl({ state, redirectUri })
    return reply.redirect(url)
  })

  app.get('/auth/callback', async (request, reply) => {
    const parsed = callbackQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_callback', message: 'Missing code/state' })
    }
    const { code, state } = parsed.data

    const expectedState = request.cookies[SSO_STATE_COOKIE]
    if (!expectedState || expectedState !== state) {
      return reply.code(400).send({ error: 'invalid_state', message: 'SSO state mismatch' })
    }
    reply.clearCookie(SSO_STATE_COOKIE, { path: '/' })

    const identity = await app.sso.exchangeCode({ code, state, redirectUri: resolveRedirectUri(request) })

    // Upsert the user. On first login we create as 'read-only' with no module
    // access — an admin must grant modules/role explicitly. Keeps zero-trust:
    // "logged in" ≠ "authorized to see anything".
    const user = await app.prisma.user.upsert({
      where: { email: identity.email },
      create: {
        email: identity.email,
        name: identity.name,
        role: 'read-only',
        modules: [],
        ssoSubject: identity.subject,
        tenantId: identity.tenantId ?? null,
        status: 'active',
        lastActiveAt: new Date(),
      },
      update: {
        ssoSubject: identity.subject,
        lastActiveAt: new Date(),
        status: 'active',
      },
    })

    const session = await app.prisma.session.create({
      data: {
        userId: user.id,
        token: randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    })

    const claims: SessionClaims = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      modules: user.modules as ModuleKey[],
      tenantId: user.tenantId,
      jti: session.id,
    }

    const token = await reply.jwtSign(claims)
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: app.env.NODE_ENV !== 'development',
      // SameSite=lax works for the single-origin dev case (localhost:5173 →
      // localhost:3001 is same-site under the eTLD+1 rule). For prod/demo
      // where web + API live on different subdomains (demo.clinwrite.ai +
      // api.clinwrite.ai), the Domain attribute below widens the cookie to
      // both subdomains so SameSite=lax still delivers it.
      sameSite: 'lax',
      ...(app.env.SESSION_COOKIE_DOMAIN && { domain: app.env.SESSION_COOKIE_DOMAIN }),
      path: '/',
      maxAge: 24 * 60 * 60,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: user.id,
      action: 'auth.login',
      entityType: 'session',
      entityId: session.id,
      details: { email: user.email, provider: app.env.SSO_PROVIDER },
      ipAddress: request.ip ?? null,
    })

    return reply.redirect(app.env.CORS_ORIGIN)
  })

  app.post('/auth/logout', { preHandler: requireAuth() }, async (request, reply) => {
    const user = request.user!
    const jti = request.authClaims?.jti
    if (jti) {
      await app.prisma.session.update({
        where: { id: jti },
        data: { revokedAt: new Date() },
      }).catch(() => undefined)  // Session may already be revoked; idempotent.
    }
    // ClearCookie must match the attrs we set — otherwise the browser
    // keeps a residual cookie with the Domain set.
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      ...(app.env.SESSION_COOKIE_DOMAIN && { domain: app.env.SESSION_COOKIE_DOMAIN }),
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: user.id,
      action: 'auth.logout',
      entityType: 'session',
      entityId: jti ?? 'unknown',
      details: { email: user.email },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })

  app.get('/auth/me', { preHandler: requireAuth() }, async (request) => {
    return request.user
  })
}

function resolveRedirectUri(request: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  // SSO callback happens on the API host (/auth/callback is a Fastify
  // route). Build from the request's own origin so the mock SSO returns
  // to the API, not the frontend. Honour X-Forwarded-Proto when behind
  // nginx-tls so we don't downgrade to http.
  if (process.env.WORKOS_REDIRECT_URI) return process.env.WORKOS_REDIRECT_URI
  const forwardedProto = (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
  const forwardedHost = (request.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim()
  const proto = forwardedProto ?? request.protocol
  const host = forwardedHost ?? request.hostname
  return `${proto}://${host}/auth/callback`
}
