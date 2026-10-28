// Role-based access control + module-scoped authorization.
//
// Migration 48 moved this file to the unified role model described in
// docs/roles-and-permissions.md §2. Five canonical roles:
//
//     tenant-admin | pm | contributor | auditor | guest
//
// Capabilities (['can-author','can-review','can-approve','can-publish'])
// live on User.capabilities and gate what RACI letter a contributor may
// hold — see docs §2.1 and the raci service.
//
// Legacy compat layer: existing route guards still spell their intent as
// requireAuth({ roles: ['admin'] }) or ['admin', 'reviewer']. During
// cutover, the middleware treats these legacy names as aliases:
//
//     'admin'    accepts the user if role is 'tenant-admin'
//     'reviewer' accepts the user if role is 'contributor' AND the
//                user has 'can-review' in capabilities
//     'read-only' accepts the user if role is 'auditor'
//
// This lets us flip User.role values atomically in migration 48 without
// chasing every route in the same commit. Route handlers migrate to the
// new names opportunistically; nothing is time-boxed yet.
//
// Why no library? The surface is small and the business rules — which
// role is a super-user, how module scoping composes, how legacy aliases
// resolve — need to live in code we fully own.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

// Canonical post-migration-48 roles.
export type CanonicalRole =
  | 'tenant-admin'
  | 'pm'
  | 'contributor'
  | 'auditor'
  | 'guest'

// Legacy role strings. Still accepted in route guards; still appear in
// User.legacy_role for audit-trail interpretation. Will be removed from
// this union once no caller references them.
export type LegacyRole =
  | 'admin'
  | 'super-admin'
  | 'clinical-writer'
  | 'scientific-writer'
  | 'medical-writer'
  | 'regulatory-writer'
  | 'ideation-lead'
  | 'reviewer'
  | 'read-only'

export type Role = CanonicalRole | LegacyRole

export type Capability =
  | 'can-author'
  | 'can-review'
  | 'can-approve'
  | 'can-publish'

export type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

// Roles that bypass module-scope checks. Only tenant-admin after
// migration 48; 'admin' retained because post-migration there are a
// pre-cutover windows where the string hasn't been rewritten yet.
const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>(['tenant-admin', 'admin'])
const ALL_MODULES: ReadonlyArray<ModuleKey> = ['A', 'B', 'C', 'D', 'E']

export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
  capabilities?: Capability[]
  modules: ModuleKey[]
  tenantId: string | null
}

export function hasModuleAccess(user: AuthenticatedUser, required: ModuleKey[]): boolean {
  if (ADMIN_ROLES.has(user.role)) return true
  if (required.length === 0) return true
  return required.some(m => user.modules.includes(m))
}

export function hasCapability(user: AuthenticatedUser, cap: Capability): boolean {
  return (user.capabilities ?? []).includes(cap)
}

// Role matcher with legacy-alias support.
//
// A required role of 'admin' is satisfied by either the exact match or
// the canonical replacement 'tenant-admin'. Same shape for 'read-only' →
// 'auditor'. 'reviewer' is special: the canonical replacement is
// 'contributor', but we also require the user to carry 'can-review' in
// capabilities so a plain contributor doesn't backdoor into a
// reviewer-only route.
export function hasRole(user: AuthenticatedUser, roles: Role[]): boolean {
  if (roles.length === 0) return true
  for (const required of roles) {
    if (user.role === required) return true
    // Legacy → canonical acceptance.
    if (required === 'admin' && user.role === 'tenant-admin') return true
    if (required === 'read-only' && user.role === 'auditor') return true
    if (required === 'reviewer' && user.role === 'contributor' && hasCapability(user, 'can-review')) return true
    // Canonical → legacy (if a route is already updated to use new
    // names but the DB still has the legacy value during the cutover
    // window).
    if (required === 'tenant-admin' && user.role === 'admin') return true
    if (required === 'auditor' && user.role === 'read-only') return true
    if (required === 'contributor' && isLegacyWriterOrReviewer(user.role)) return true
  }
  return false
}

function isLegacyWriterOrReviewer(role: Role): boolean {
  return (
    role === 'clinical-writer' ||
    role === 'scientific-writer' ||
    role === 'medical-writer' ||
    role === 'regulatory-writer' ||
    role === 'ideation-lead' ||
    role === 'reviewer'
  )
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
  // Default: every module (A|B|C|D|E) on. Matches the env.ts default.
  // The 2026-10-06 pivot's 'A'-only default was flipped 2026-10-21 so
  // new deployments get the full surface without a bespoke env.
  const raw = process.env.FEATURE_MODULES_ENABLED ?? 'A,B,C,D,E'
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
