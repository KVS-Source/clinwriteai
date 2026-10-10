// Auth Fastify plugin — wires @fastify/cookie, @fastify/jwt, the SSO provider,
// and the auth routes. Decorates `app.sso` and request.user.
//
// Depends on: prisma plugin (session persistence), audit plugin (login audit),
// cookie plugin (session cookie storage). Register this AFTER those.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { createSsoProvider, type SsoProvider } from './sso.js'
import { authRoutes } from './routes.js'
import { SESSION_COOKIE_NAME, type SessionClaims } from './jwt.js'
import type { AuthenticatedUser, ModuleKey, Role } from './rbac.js'

const authPlugin: FastifyPluginAsync = async (app) => {
  const jwtSecret = await app.secrets.getSecret('JWT_SECRET')
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters')
  }

  await app.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: {
      cookieName: SESSION_COOKIE_NAME,
      signed: false,
    },
    sign: {
      expiresIn: app.env.JWT_EXPIRY,
    },
  })

  const sso: SsoProvider = createSsoProvider({
    provider: app.env.SSO_PROVIDER,
    workosApiKey: process.env.WORKOS_API_KEY,
    workosClientId: process.env.WORKOS_CLIENT_ID,
  })
  app.decorate('sso', sso)

  // AUTH_BYPASS_EMAIL (demo + dev only) — mirrors the SPA's VITE_BYPASS_AUTH
  // flag on the server side. When set, any request without a valid session
  // cookie is treated as the named user. Keeps the demo prototype usable
  // without the SSO roundtrip (which requires an IdP that we don't have
  // provisioned yet). MUST be unset once WorkOS lands.
  const BYPASS_EMAIL = (process.env.AUTH_BYPASS_EMAIL ?? '').trim().toLowerCase() || null
  if (BYPASS_EMAIL) {
    app.log.warn(
      { bypassEmail: BYPASS_EMAIL },
      'AUTH_BYPASS_EMAIL is set — all unauthenticated requests resolve as this user. Do NOT use in production.',
    )
  }

  // COLLAB_SYSTEM_TOKEN — shared secret the Yjs collab sidecar (apps/
  // collab-server) sends on X-System-Token when persisting a doc.
  // Lets the sidecar's unauthenticated process write via normal
  // requireAuth-gated routes. Resolves to a synthetic 'system:collab'
  // user with super-admin equivalence so module gates pass.
  const COLLAB_SYSTEM_TOKEN = (process.env.COLLAB_SYSTEM_TOKEN ?? '').trim() || null

  // Decode the session cookie on every request (silent — unauth routes stay
  // open). requireAuth() enforces the gate for protected routes.
  app.addHook('onRequest', async (request) => {
    try {
      // --- System-token path (collab sidecar) ---------------------------
      // Checked first so the sidecar never pays the Prisma lookup for a
      // real user.
      if (COLLAB_SYSTEM_TOKEN) {
        const header = request.headers['x-system-token']
        const presented = Array.isArray(header) ? header[0] : header
        if (presented && presented === COLLAB_SYSTEM_TOKEN) {
          request.user = {
            id: 'system:collab',
            email: 'collab-sidecar@localhost',
            role: 'super-admin',
            modules: ['A', 'B', 'C', 'D', 'E'],
            tenantId: null,
          }
          return
        }
      }

      const token = request.cookies[SESSION_COOKIE_NAME]
      if (token) {
        const claims = await request.jwtVerify<SessionClaims>()

        // Re-load the user so revocations and role changes propagate without
        // waiting for token expiry. If the Session row is gone or revoked,
        // treat the request as anonymous.
        const session = await app.prisma.session.findUnique({ where: { id: claims.jti } })
        if (session && !session.revokedAt && session.expiresAt >= new Date()) {
          const dbUser = await app.prisma.user.findUnique({ where: { id: claims.sub } })
          if (dbUser && dbUser.status === 'active') {
            request.user = {
              id: dbUser.id,
              email: dbUser.email,
              role: dbUser.role as Role,
              modules: dbUser.modules as ModuleKey[],
              tenantId: dbUser.tenantId ?? null,
            }
            request.authClaims = claims
            return
          }
        }
      }

      // Fallback — demo bypass. Only engages if no valid session was
      // established above AND AUTH_BYPASS_EMAIL is set.
      if (BYPASS_EMAIL && !request.user) {
        const dbUser = await app.prisma.user.findUnique({ where: { email: BYPASS_EMAIL } })
        if (dbUser && dbUser.status === 'active') {
          request.user = {
            id: dbUser.id,
            email: dbUser.email,
            role: dbUser.role as Role,
            modules: dbUser.modules as ModuleKey[],
            tenantId: dbUser.tenantId ?? null,
          }
        }
      }
    } catch {
      // Invalid/expired token → fall through to bypass if configured.
      if (BYPASS_EMAIL && !request.user) {
        const dbUser = await app.prisma.user.findUnique({ where: { email: BYPASS_EMAIL } })
        if (dbUser && dbUser.status === 'active') {
          request.user = {
            id: dbUser.id,
            email: dbUser.email,
            role: dbUser.role as Role,
            modules: dbUser.modules as ModuleKey[],
            tenantId: dbUser.tenantId ?? null,
          }
        }
      }
    }
  })

  await app.register(authRoutes)
}

declare module 'fastify' {
  interface FastifyInstance {
    sso: SsoProvider
  }
  interface FastifyRequest {
    authClaims?: SessionClaims
  }
}

// Teach @fastify/jwt what our session payload + request.user look like so
// handlers get a strongly-typed request.user without the module-augmentation
// collision that comes from redeclaring it on FastifyRequest directly.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionClaims
    user: AuthenticatedUser
  }
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['prisma', 'audit'],
})
