import { describe, expect, it } from 'vitest'
import { buildInviteUrl, checkInvitation, generateInvitationToken, hashInvitationToken, INVITATION_TTL_MS } from './invitations.js'

const future = () => new Date(Date.now() + 60_000)
const past = () => new Date(Date.now() - 60_000)

describe('invitation tokens', () => {
  it('stores only a hash that matches the raw token', () => {
    const { token, tokenHash, expiresAt } = generateInvitationToken()
    expect(tokenHash).toBe(hashInvitationToken(token))
    expect(tokenHash).not.toContain(token)
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(INVITATION_TTL_MS - 5_000)
  })
  it('generates unique tokens', () => {
    expect(generateInvitationToken().token).not.toBe(generateInvitationToken().token)
  })
  it('builds a url-encoded accept link', () => {
    expect(buildInviteUrl('https://app.test/', 'a+b')).toBe('https://app.test/accept-invitation?token=a%2Bb')
  })
})

describe('checkInvitation', () => {
  const live = { expiresAt: future(), acceptedAt: null, revokedAt: null }
  it('accepts a live invitation for an invited user', () => {
    expect(checkInvitation(live, 'invited')).toEqual({ valid: true })
  })
  it.each([
    [null, 'invited', 'not_found'],
    [{ ...live, revokedAt: new Date() }, 'invited', 'revoked'],
    [{ ...live, acceptedAt: new Date() }, 'invited', 'accepted'],
    [{ ...live, expiresAt: past() }, 'invited', 'expired'],
    [live, 'suspended', 'user_not_invited'],
  ] as const)('rejects case %#', (inv, status, reason) => {
    expect(checkInvitation(inv, status)).toEqual({ valid: false, reason })
  })
})

describe('invitation link lifetime — 15 minutes', () => {
  it('is 15 minutes', () => {
    expect(INVITATION_TTL_MS).toBe(15 * 60 * 1000)
  })

  it('a link is live at 14 minutes and expired at 16', () => {
    const issued = new Date('2026-11-05T10:00:00Z')
    const { expiresAt } = (() => {
      const realNow = Date.now
      Date.now = () => issued.getTime()
      try { return generateInvitationToken() } finally { Date.now = realNow }
    })()
    const inv = { expiresAt, acceptedAt: null, revokedAt: null }
    expect(checkInvitation(inv, 'invited', new Date(issued.getTime() + 14 * 60 * 1000))).toEqual({ valid: true })
    expect(checkInvitation(inv, 'invited', new Date(issued.getTime() + 16 * 60 * 1000))).toEqual({ valid: false, reason: 'expired' })
  })
})
