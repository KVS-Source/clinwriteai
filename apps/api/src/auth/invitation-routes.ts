// Public invitation endpoints (AC-PM-007).
//
//   GET  /auth/invitations/preview?token=...   what the accept page shows
//   POST /auth/invitations/accept              { token, acceptTerms: true }
//
// Accepting here does NOT activate the account. It validates the link,
// records that T&C were accepted in the browser, and stores the token in a
// short-lived httpOnly cookie. The account is activated in /auth/callback
// once SSO proves the signer owns the invited email — so a leaked link
// can't be used to take over someone else's invitation.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { checkInvitation, hashInvitationToken } from '../modules/platform/users/invitations.js'

export const INVITE_COOKIE = 'aurora_invite'
export const INVITE_COOKIE_TTL_SECONDS = 10 * 60

const previewQuery = z.object({ token: z.string().min(16).max(128) })
const acceptBody = z.object({
  token: z.string().min(16).max(128),
  acceptTerms: z.literal(true),
})

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
}
