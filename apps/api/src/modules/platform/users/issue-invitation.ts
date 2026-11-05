// Rotate a user's invitation: revoke any live one, issue a fresh token, and queue the invitation
// email. Email failure never fails the invite: `emailQueued` says whether the message was handed to
// the delivery queue. Used by the admin user screens and by a PM inviting another PM to a project.

import type { User } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { buildInviteUrl, generateInvitationToken } from './invitations.js'

export async function issueUserInvitation(app: FastifyInstance, user: User, invitedBy: string, note?: string) {
  const { token, tokenHash, expiresAt } = generateInvitationToken()
  await app.prisma.$transaction([
    app.prisma.userInvitation.updateMany({
      where: { userId: user.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    app.prisma.userInvitation.create({ data: { userId: user.id, tokenHash, expiresAt, invitedBy } }),
  ])
  const inviteUrl = buildInviteUrl(app.env.CORS_ORIGIN, token)
  const inviteExpiresAt = expiresAt.toISOString()

  let emailQueued = false
  try {
    await app.notifications.send({
      recipientId: user.id,
      kind: 'user.invitation',
      title: 'You have been invited to ClinWrite',
      body:
        `Hello ${user.name},

` +
        `You have been invited to ClinWrite as ${user.role}. ` +
        (note ? `${note} ` : '') +
        `Open the link below, accept the Terms & Conditions, then sign in with ${user.email}.

` +
        `${inviteUrl}

` +
        `This link expires on ${expiresAt.toUTCString()}.`,
      channels: ['email'],
      // The raw link is deliberately kept out of `payload` (and so out of
      // the persisted notification metadata); it travels only in the body.
      payload: { userId: user.id, expiresAt: inviteExpiresAt },
    })
    emailQueued = true
  } catch (err) {
    app.log.error({ err, userId: user.id }, 'failed to queue invitation email')
  }
  return { inviteUrl, inviteExpiresAt, emailQueued }
}
