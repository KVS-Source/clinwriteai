// Public invitation endpoints (AC-PM-007).
//
//   GET  /auth/invitations/preview?token=...   what the accept page shows
//   POST /auth/invitations/accept              { token, acceptTerms: true }
//   POST /auth/invitations/register            { token, name, tenantRef?, newPassword, acceptTerms } → activate + set password
//
// `accept` is the legacy SSO path: it validates the link, records that T&C
// were accepted in the browser, and stores the token in a short-lived
// httpOnly cookie; the account is activated in /auth/callback once SSO proves
// the signer owns the invited email. `register` is the first-party password
// path (Phase A): the invitee sets their own password, which activates the
// account in one step (invited → active) so they can sign in with email +
// password — no SSO IdP required. Both consume the one-time token, so a
// leaked link can't be reused once the invitee has registered.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { checkInvitation, hashInvitationToken, TERMS_VERSION } from '../modules/platform/users/invitations.js'
import { hashPassword, validatePasswordPolicy } from './password.js'

export const INVITE_COOKIE = 'aurora_invite'
export const INVITE_COOKIE_TTL_SECONDS = 10 * 60

const previewQuery = z.object({ token: z.string().min(16).max(128) })
const acceptBody = z.object({
  token: z.string().min(16).max(128),
  acceptTerms: z.literal(true),
})
const registerBody = z.object({
  token: z.string().min(16).max(128),
  // The invitee enters their own name; it replaces the one derived from the email at invite time.
  name: z.string().trim().min(1).max(120),
  // Optional free-text Tenant ID, stored as entered (users.tenant_ref). It is
  // not the tenant link (users.tenantId), which stays as the admin set it.
  tenantRef: z.string().trim().max(100).optional(),
  newPassword: z.string().min(1).max(128),
  acceptTerms: z.literal(true),
})

// "Jane Doe" → "JD"; at most two letters, matching the initials elsewhere in the app.
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

// Tight per-route limit: these are unauthenticated and token-guessing targets.
const limit = { rateLimit: { max: 20, timeWindow: '1 minute' } }

export const invitationRoutes: FastifyPluginAsync = async (app) => {
  async function lookup(token: string) {
    const invitation = await app.prisma.userInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { user: { select: { email: true, name: true, role: true, status: true } } },
    })
    return { invitation, check: checkInvitation(invitation, invitation?.user.status ?? null) }
  }

  app.get('/auth/invitations/preview', { config: limit }, async (request, reply) => {
    const parsed = previewQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation' })
    const { invitation, check } = await lookup(parsed.data.token)
    // Don't tell a caller who holds a bad token anything about the account.
    if (!invitation || !check.valid) return { valid: false, reason: check.valid ? 'not_found' : check.reason }
    return {
      valid: true,
      email: invitation.user.email,
      name: invitation.user.name,
      role: invitation.user.role,
      expiresAt: invitation.expiresAt.toISOString(),
    }
  })

  app.post('/auth/invitations/accept', { config: limit }, async (request, reply) => {
    const parsed = acceptBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', message: 'Terms must be accepted to continue' })
    }
    const { invitation, check } = await lookup(parsed.data.token)
    if (!invitation || !check.valid) {
      return reply.code(410).send({ error: 'invitation_invalid', reason: check.valid ? 'not_found' : check.reason })
    }

    reply.setCookie(INVITE_COOKIE, parsed.data.token, {
      httpOnly: true,
      secure: app.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      ...(app.env.SESSION_COOKIE_DOMAIN && { domain: app.env.SESSION_COOKIE_DOMAIN }),
      path: '/',
      maxAge: INVITE_COOKIE_TTL_SECONDS,
    })
    return { ok: true, email: invitation.user.email }
  })

  // First-party registration: the invitee sets their own password straight
  // from the invite link. This activates the account in one step, so the
  // user can immediately sign in with email + the password they just chose.
  app.post('/auth/invitations/register', { config: limit }, async (request, reply) => {
    const parsed = registerBody.safeParse(request.body)
    if (!parsed.success) {
      const field = (name: string) => parsed.error.issues.some(i => i.path[0] === name)
      return reply.code(400).send({
        error: 'validation',
        message: field('name') ? 'Name is required'
          : field('acceptTerms') ? 'Terms must be accepted to continue'
          : 'Invalid registration details',
      })
    }

    const policyIssues = validatePasswordPolicy(parsed.data.newPassword)
    if (policyIssues.length > 0) {
      return reply.code(400).send({ error: 'password_policy', issues: policyIssues })
    }

    const { invitation, check } = await lookup(parsed.data.token)
    if (!invitation || !check.valid) {
      return reply.code(410).send({ error: 'invitation_invalid', reason: check.valid ? 'not_found' : check.reason })
    }

    // Free text, saved exactly as entered (trimmed); blank saves nothing.
    const tenantRef = parsed.data.tenantRef || null

    const now = new Date()
    const passwordHash = await hashPassword(parsed.data.newPassword)
    // One transaction: consume the token, set the password, and flip the
    // account to active with the T&C recorded. Any other live invitation for
    // this user is revoked so a second outstanding link can't be reused.
    await app.prisma.$transaction([
      app.prisma.userInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: now } }),
      app.prisma.userInvitation.updateMany({
        where: { userId: invitation.userId, acceptedAt: null, revokedAt: null, id: { not: invitation.id } },
        data: { revokedAt: now },
      }),
      app.prisma.user.update({
        where: { id: invitation.userId },
        data: {
          name: parsed.data.name,
          initials: initialsOf(parsed.data.name),
          tenantRef,
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          status: 'active',
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
        },
      }),
    ])

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: invitation.userId,
      action: 'user.invitation.register',
      entityType: 'user',
      entityId: invitation.userId,
      details: { email: invitation.user.email, termsVersion: TERMS_VERSION, tenantRef },
      ipAddress: request.ip ?? null,
    })

    // Clear the SSO-path invite cookie if one was set by a prior /accept.
    reply.clearCookie(INVITE_COOKIE, {
      path: '/',
      ...(app.env.SESSION_COOKIE_DOMAIN && { domain: app.env.SESSION_COOKIE_DOMAIN }),
    })
    return { ok: true, email: invitation.user.email }
  })
}
