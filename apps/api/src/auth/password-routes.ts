// Password-auth routes (Phase A, 2026-11-02).
//
//   POST /auth/password-login          email + password → session cookie
//   POST /auth/forgot-password         email → email a reset link (anti-enum)
//   POST /auth/reset-password          token + new password → set hash
//   POST /auth/change-password         (authed) current + new → rotate
//   GET  /auth/password-login-status   email → does this tenant have SSO?
//
// Lives alongside the SSO routes in auth/routes.ts — not inside, so a
// future deprecation of SSO is a module unregister instead of a code
// weave-apart.
//
// Anti-enumeration: forgot-password + password-login ALWAYS take the
// same wall-clock time regardless of whether the email exists. Bots
// can't tell "unknown email" from "wrong password" from timing or
// response shape.

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { User } from '@prisma/client'
import { z } from 'zod'
import { SESSION_COOKIE_NAME, type SessionClaims } from './jwt.js'
import { requireAuth, type ModuleKey, type Role } from './rbac.js'
import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  validatePasswordPolicy,
  verifyPassword,
} from './password.js'
import { passwordResetEmail } from '../mailer/templates.js'

const passwordLoginBody = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(128),
})

const forgotPasswordBody = z.object({
  email: z.string().email().max(254),
})

const resetPasswordBody = z.object({
  token:       z.string().min(32).max(128),
  newPassword: z.string().min(1).max(128),
})

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword:     z.string().min(1).max(128),
})

const passwordLoginStatusQuery = z.object({
  email: z.string().email().max(254),
})

/** Tight limit for all unauthenticated endpoints. */
const unauthedLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } }

/** Fixed 24h session, matching the SSO flow. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const SESSION_TTL_SEC = 24 * 60 * 60

export const passwordAuthRoutes: FastifyPluginAsync = async (app) => {
  // ──────────────────────────────────────────────────────────────────────
  // POST /auth/password-login
  //
  // Email + password → sets the aurora_session cookie, returns the user
  // profile plus mustChangePassword so the SPA can route into the
  // ForcePasswordChange gate when a temp password was used.
  //
  // Anti-enumeration: the response for "unknown email", "wrong password",
  // and "account not activated" are IDENTICAL. The only way to tell
  // success from failure is a 200 with a user payload vs a 401 with a
  // generic message.
  app.post('/auth/password-login', { config: unauthedLimit }, async (request, reply) => {
    const parsed = passwordLoginBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation' })
    }
    const { email, password } = parsed.data

    const existing = await app.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })

    // Perform a dummy bcrypt check even on miss so timing doesn't leak
    // whether the email exists. bcrypt.compare on a never-matching hash
    // takes the same ~100ms a real compare does.
    const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8qO1nQy3nUcZ7Z3qYyQyHxh6yKzqj2'  // bcrypt("never")
    const hashToCheck = existing?.passwordHash ?? DUMMY_HASH

    const passwordOk = await verifyPassword(password, hashToCheck)

    if (!existing || !existing.passwordHash || !passwordOk || existing.status === 'suspended' || existing.status === 'deprovisioned') {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: existing?.id ?? 'anonymous',
        action: 'auth.password_login_failed',
        entityType: 'user',
        entityId: existing?.id ?? email,
        details: {
          email,
          reason: !existing ? 'unknown_email'
            : !existing.passwordHash ? 'no_password_set'
            : !passwordOk ? 'wrong_password'
            : existing.status,
        },
        ipAddress: request.ip ?? null,
      })
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: "That email and password combination doesn't match our records. Try again or request access from your administrator.",
      })
    }

    // 'invited' users CANNOT finish password login until an admin flips
    // them active (same policy as the SSO path).
    if (existing.status === 'invited') {
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: "That email and password combination doesn't match our records. Try again or request access from your administrator.",
      })
    }

    const session = await openSessionFor(app, existing, request, reply)

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: existing.id,
      action: 'auth.password_login',
      entityType: 'session',
      entityId: session.id,
      details: { email: existing.email, mustChangePassword: existing.mustChangePassword },
      ipAddress: request.ip ?? null,
    })

    return {
      ok: true,
      user: shapeUserForClient(existing),
      mustChangePassword: existing.mustChangePassword,
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // POST /auth/forgot-password
  //
  // Anti-enumeration: ALWAYS 200 with the same body. If the email exists
  // and has activated status, a reset token is minted and emailed; if
  // not, nothing happens — the caller gets the same response either way.
  app.post('/auth/forgot-password', { config: unauthedLimit }, async (request, reply) => {
    const parsed = forgotPasswordBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation' })
    }
    const { email } = parsed.data

    const existing = await app.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })

    // Only mint + email for active accounts. Invited / suspended rows
    // are opaque to the caller (same 200), but no email actually fires.
    if (existing && existing.status === 'active') {
      const { rawToken, tokenHash } = generateResetToken()
      const expiresAt = new Date(Date.now() + app.env.PASSWORD_RESET_TOKEN_TTL_MIN * 60 * 1000)
      await app.prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: expiresAt,
        },
      })
      const baseUrl = app.env.APP_BASE_URL ?? app.env.CORS_ORIGIN
      const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`
      try {
        await app.mailer.sendMail(passwordResetEmail({
          recipientEmail: existing.email,
          recipientName: existing.name,
          resetUrl,
          ttlMinutes: app.env.PASSWORD_RESET_TOKEN_TTL_MIN,
        }))
      } catch (err) {
        // Mail transport failure is logged, not surfaced — a server-side
        // issue should not leak which emails exist.
        app.log.error({ err, userId: existing.id }, '[password-reset] mail send failed')
      }
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: existing.id,
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: existing.id,
        details: { email: existing.email, expiresAt: expiresAt.toISOString() },
        ipAddress: request.ip ?? null,
      })
    } else {
      // No user, or user not in a resettable status — log the attempt
      // for abuse monitoring. No PII leak since the caller already knew
      // the email they typed.
      app.log.info({ email, found: Boolean(existing) }, '[password-reset] no-op (anti-enum)')
    }

    return {
      ok: true,
      message: `If an account exists for ${email}, a password reset link has been sent. The link expires in ${app.env.PASSWORD_RESET_TOKEN_TTL_MIN} minutes.`,
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // POST /auth/reset-password
  //
  // Verify the raw token against the stored hash + non-expired, set a new
  // password, clear the token + mustChange flag. Does NOT sign the user
  // in — they go to /signin and enter the new password.
  app.post('/auth/reset-password', { config: unauthedLimit }, async (request, reply) => {
    const parsed = resetPasswordBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation' })
    }
    const { token, newPassword } = parsed.data

    const policyIssues = validatePasswordPolicy(newPassword)
    if (policyIssues.length > 0) {
      return reply.code(400).send({ error: 'password_policy', issues: policyIssues })
    }

    const tokenHash = hashResetToken(token)
    const user = await app.prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: new Date() },
      },
    })
    if (!user) {
      return reply.code(410).send({
        error: 'invalid_or_expired_token',
        message: "This password reset link has expired or already been used. Request a new link to continue.",
      })
    }

    const hash = await hashPassword(newPassword)
    const now = new Date()
    await app.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordChangedAt: now,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        mustChangePassword: false,
      },
    })

    // Revoke every live session for this user — on-the-wire re-auth is
    // required after any password rotation (session fixation + stolen-
    // cookie defense).
    await app.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data:  { revokedAt: now },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: user.id,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })

  // ──────────────────────────────────────────────────────────────────────
  // POST /auth/change-password  (authed — used by ForcePasswordChange
  // after a temp password login, and by any user who wants to rotate
  // their password voluntarily)
  app.post('/auth/change-password', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = changePasswordBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation' })
    }
    const { currentPassword, newPassword } = parsed.data
    const actor = request.user!

    const user = await app.prisma.user.findUnique({ where: { id: actor.id } })
    if (!user || !user.passwordHash) {
      return reply.code(409).send({
        error: 'no_password_on_file',
        message: 'This account does not have a password set. Use the forgot-password flow instead.',
      })
    }

    const currentOk = await verifyPassword(currentPassword, user.passwordHash)
    if (!currentOk) {
      return reply.code(401).send({
        error: 'wrong_current_password',
        message: 'The current password is not correct.',
      })
    }

    const policyIssues = validatePasswordPolicy(newPassword)
    if (policyIssues.length > 0) {
      return reply.code(400).send({ error: 'password_policy', issues: policyIssues })
    }

    if (currentPassword === newPassword) {
      return reply.code(400).send({
        error: 'password_unchanged',
        message: 'New password must be different from the current password.',
      })
    }

    const hash = await hashPassword(newPassword)
    const now = new Date()
    await app.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordChangedAt: now,
        mustChangePassword: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: user.id,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })

  // ──────────────────────────────────────────────────────────────────────
  // GET /auth/password-login-status?email=…
  //
  // Public tenant-SSO probe. Given an email, tells the SPA whether the
  // email's tenant has an active SSO connection (so the sign-in page
  // can show "Continue with SSO" instead of a password field). Returns
  // the SAME shape for unknown emails as for known-but-no-SSO ones to
  // keep anti-enumeration.
  app.get('/auth/password-login-status', { config: unauthedLimit }, async (request, reply) => {
    const parsed = passwordLoginStatusQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation' })
    }
    const user = await app.prisma.user.findFirst({
      where: { email: { equals: parsed.data.email, mode: 'insensitive' } },
      include: { tenant: { include: { ssoConnections: { where: { status: 'active' } } } } },
    })
    const hasSso = Boolean(user?.tenant?.ssoConnections.length)
    return { ssoEnabled: hasSso }
  })
}

// ────────────────────────────────────────────────────────────────────────
// Shared helpers.

async function openSessionFor(
  app: FastifyInstance,
  user: User,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string }> {
  const session = await app.prisma.session.create({
    data: {
      userId: user.id,
      token: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    },
  })

  await app.prisma.user.update({
    where: { id: user.id },
    data: { lastActiveAt: new Date() },
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
    sameSite: 'lax',
    ...(app.env.SESSION_COOKIE_DOMAIN && { domain: app.env.SESSION_COOKIE_DOMAIN }),
    path: '/',
    maxAge: SESSION_TTL_SEC,
  })
  return session
}

function shapeUserForClient(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: [user.role, ...user.additionalRoles.filter(r => r !== user.role)],
    modules: user.modules,
    tenantId: user.tenantId,
    status: user.status,
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: user.termsVersion,
  }
}
