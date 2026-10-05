// Role-based access control + module-scoped authorization.
//
// Model (per docs/demo/02-datamodel.md User):
//   - User.role is a single string. 'super-admin' and 'admin' bypass module
//     scoping; module-specific roles ('clinical-writer', 'reviewer', etc.) only
//     grant access to the modules listed in User.modules.
//   - A route protected with `requireAuth(['A','B'])` demands either an admin
//     role OR a module intersect with ['A','B'].
//
// Why no library? The surface is small (two checks) and the business rules —
// which role is a super-user, how module scoping composes — need to live in
// code we fully own. A general-purpose RBAC lib adds concepts (permissions,
// policies) we don't need yet.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

export type Role =
  | 'super-admin'
  | 'admin'
  | 'clinical-writer'
  | 'scientific-writer'
  | 'medical-writer'
  | 'regulatory-writer'
  | 'ideation-lead'
  | 'reviewer'
  | 'read-only'

export type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['super-admin', 'admin'])

export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
  modules: ModuleKey[]
  tenantId: string | null
}

export function hasModuleAccess(user: AuthenticatedUser, required: ModuleKey[]): boolean {
  if (ADMIN_ROLES.has(user.role)) return true
  if (required.length === 0) return true
  return required.some(m => user.modules.includes(m))
}

export function hasRole(user: AuthenticatedUser, roles: Role[]): boolean {
  if (roles.length === 0) return true
  return roles.includes(user.role)
}

/**
 * preHandler factory — returns a Fastify hook that 401s if unauthenticated and
 * 403s if the user doesn't satisfy both the role + module gates.
 *
 * Usage:
 *   app.get('/documents', { preHandler: requireAuth({ modules: ['A'] }) }, handler)
 *   app.post('/admin/users', { preHandler: requireAuth({ roles: ['admin'] }) }, handler)
 */
export function requireAuth(opts: { roles?: Role[]; modules?: ModuleKey[] } = {}): preHandlerHookHandler {
  const requiredRoles = opts.roles ?? []
  const requiredModules = opts.modules ?? []

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user
    if (!user) {
      reply.code(401).send({ error: 'unauthenticated', message: 'Authentication required' })
      return reply
    }

    if (!hasRole(user, requiredRoles)) {
      reply.code(403).send({
        error: 'forbidden',
        message: `Role '${user.role}' lacks required role (needs one of: ${requiredRoles.join(', ')})`,
      })
      return reply
    }

    if (!hasModuleAccess(user, requiredModules)) {
      reply.code(403).send({
        error: 'forbidden',
        message: `User lacks access to any of required modules: ${requiredModules.join(', ')}`,
      })
      return reply
    }
  }
}
