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
const ALL_MODULES: ReadonlyArray<ModuleKey> = ['A', 'B', 'C', 'D', 'E']

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

// Deployment-wide module kill-switch. Reads FEATURE_MODULES_ENABLED
// lazily and caches the parsed set. A route whose required-modules list
// doesn't intersect this set returns 503 before any auth check — the
// enablement is a deployment property, not sensitive, so leaking it
// pre-auth is fine and keeps auth-failure logs clean when a module is
// off. See docs/pivot-plan.md Arc 1.
let enabledModulesCache: Set<ModuleKey> | null = null

export function enabledModules(): Set<ModuleKey> {
  if (enabledModulesCache) return enabledModulesCache
  const raw = process.env.FEATURE_MODULES_ENABLED ?? 'A'
  const parsed = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter((s): s is ModuleKey => (ALL_MODULES as readonly string[]).includes(s))
  enabledModulesCache = new Set(parsed.length > 0 ? parsed : ['A'])
  return enabledModulesCache
}

export function isModuleEnabled(required: ModuleKey[]): boolean {
  if (required.length === 0) return true
  const enabled = enabledModules()
  return required.some(m => enabled.has(m))
}

// Test-only reset — do not call from production code.
export function _resetEnabledModulesCache(): void {
  enabledModulesCache = null
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
    // Deployment-level kill-switch runs before auth so disabled modules
    // return 503 regardless of whether the caller is signed in.
    if (!isModuleEnabled(requiredModules)) {
      reply.code(503).send({
        error: 'module_disabled',
        message: `Module(s) ${requiredModules.join(',')} are not enabled on this deployment`,
        enabledModules: Array.from(enabledModules()).sort(),
      })
      return reply
    }

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
