// JWT helpers — thin typed wrapper around @fastify/jwt so handlers get a
// strongly-typed `request.user` after `request.jwtVerify()`.
//
// Session model (Phase 1):
//   - On successful SSO exchange, we issue a signed JWT with the user id,
//     email, role, and modules. The claim set deliberately stays small —
//     subsequent requests hit `app.prisma.user.findUnique` to refresh the
//     authoritative role/modules so revocations take effect without waiting
//     for the token to expire.
//   - Token lives in an httpOnly, Secure, SameSite=Lax cookie. The cookie
//     name is `aurora_session`.
//
// Expiry: JWT_EXPIRY from env (default 24h). Rotation on logout happens by
// marking the Session row revokedAt and refusing tokens whose jti doesn't
// correspond to a live session (Phase 1 Week 5).

import type { ModuleKey, Role } from './rbac.js'

export interface SessionClaims {
  sub: string             // User.id
  email: string
  role: Role
  modules: ModuleKey[]
  tenantId: string | null
  jti: string             // ties the token to a Session row for revocation
}

export const SESSION_COOKIE_NAME = 'aurora_session'
