// How requests are counted for the global rate limit (@fastify/rate-limit).
//
//   - Per person: a signed-in user has their own counters, so colleagues behind one office IP don't share a
//     limit. Anyone else is counted by IP. The identity comes from request.user, which the auth plugin has
//     already verified: this hook runs at route level, after its onRequest hook, so a made-up cookie can't
//     be used to get a fresh counter.
//   - Reads and writes apart: one document page makes 10-15 GETs, so browsing needs far more room than
//     changing things, and a burst of reading must not use up the allowance for a save.
//   - /auth/me is never limited: it decides who the user is, and refusing it would look like being signed out.
//
// A route can still set its own stricter limit (sign-in, signing, invitations).

import type { FastifyRequest } from 'fastify'

export const SIGNED_IN_READS_PER_MINUTE = 600
export const DEFAULT_REQUESTS_PER_MINUTE = 100

const isRead = (req: FastifyRequest) => req.method === 'GET' || req.method === 'HEAD'
const isExempt = (req: FastifyRequest) => {
  const path = req.url.split('?')[0]!
  // SSO callback: being redirected from the IdP shouldn't ever trip the limit mid-login.
  return path.startsWith('/auth/callback') || path === '/auth/me'
}

export const rateLimitCounting = {
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => `${req.user?.id ?? req.ip}:${isRead(req) ? 'read' : 'write'}`,
  max: (req: FastifyRequest) => (req.user && isRead(req) ? SIGNED_IN_READS_PER_MINUTE : DEFAULT_REQUESTS_PER_MINUTE),
  allowList: isExempt,
}
