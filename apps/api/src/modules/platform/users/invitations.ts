// Invitation tokens (AC-PM-007): 7-day one-time sign-up link.
// Only the SHA-256 of the token is persisted; the raw token lives in the
// link given to the admin.

import { createHash, randomBytes } from 'node:crypto'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const TERMS_VERSION = '1.0'

export function generateInvitationToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) }
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function buildInviteUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(token)}`
}

export type InvitationCheck =
  | { valid: true }
  | { valid: false; reason: 'not_found' | 'revoked' | 'accepted' | 'expired' | 'user_not_invited' }

export function checkInvitation(
  inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null } | null,
  userStatus: string | null,
  now: Date = new Date(),
): InvitationCheck {
  if (!inv) return { valid: false, reason: 'not_found' }
  if (inv.revokedAt) return { valid: false, reason: 'revoked' }
  if (inv.acceptedAt) return { valid: false, reason: 'accepted' }
  if (inv.expiresAt < now) return { valid: false, reason: 'expired' }
  if (userStatus !== 'invited') return { valid: false, reason: 'user_not_invited' }
  return { valid: true }
}
