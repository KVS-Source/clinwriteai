// Active role — a user who holds two roles works as one of them at a time (as in Genrac).
//
// The top-bar role switcher stores the chosen role and the web client sends it on every request as
// X-Active-Role. When the user holds that role, the request runs as that role only: `role` becomes it
// and `roles` narrows to it, so every check (hasRole, hasAnyRole, onlyRolesIn, isReadOnly…) sees what
// the screen shows. The switch therefore binds on the server, not just in the UI: a PM + Auditor
// working as Auditor gets the Auditor's read-only answers.
//
// A role the user doesn't hold (stale value, another user's choice in the same browser, a guess) is
// ignored and the request runs with every role held — never more than the user was granted.

import type { AuthenticatedUser, Role } from './rbac.js'

export const ACTIVE_ROLE_HEADER = 'x-active-role'

export function withActiveRole(user: AuthenticatedUser, header: string | string[] | undefined): AuthenticatedUser {
  const wanted = (Array.isArray(header) ? header[0] : header)?.trim()
  const held = user.roles && user.roles.length > 0 ? user.roles : [user.role]
  if (!wanted || held.length < 2 || !held.includes(wanted as Role)) return user
  return { ...user, role: wanted as Role, roles: [wanted as Role] }
}
