// Admin role names. The API reports the canonical role ('tenant-admin',
// migration 48); demo personas and rows not yet rewritten still say 'admin'
// ('super-admin' is retired but tolerated). The API's hasRole() accepts all of
// them for an 'admin' route, so the UI must too — checking `role === 'admin'`
// alone hides every admin page from a real Tenant Admin.
export const ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'tenant-admin', 'super-admin'])

export const isAdminRole = (role: string | null | undefined): boolean => !!role && ADMIN_ROLES.has(role)

/** Platform admin (GenBioCa operator): an admin role with no tenant. */
export const isPlatformAdmin = (user: { role: string; tenantId?: string | null }): boolean =>
  isAdminRole(user.role) && (user.tenantId ?? null) == null

/** Auditors only read Clinical Writing. The API refuses their writes (AUDITOR_READ_ONLY);
 *  this keeps screens from offering, or quietly attempting, what would be refused. */
export const isReadOnlyRole = (role: string | null | undefined): boolean => role === 'auditor' || role === 'read-only'

// A user may hold two roles (e.g. Project manager + Contributor); rights are the union, as on the
// API (apps/api/src/auth/rbac.ts). An admin role is never combined, so admin checks on `role` hold.
type WithRoles = { role: string; roles?: readonly string[] | null } | null | undefined
export const rolesOf = (u: WithRoles): string[] => (!u ? [] : u.roles && u.roles.length > 0 ? [...u.roles] : [u.role])
/** A grant: true if any role the user holds is one of `names`. */
export const holdsRole = (u: WithRoles, ...names: string[]): boolean => rolesOf(u).some(r => names.includes(r))
/** Read-only only when every role the user holds is read-only (an Auditor who is also a PM can act as a PM). */
export const isReadOnlyUser = (u: WithRoles): boolean => { const r = rolesOf(u); return r.length > 0 && r.every(isReadOnlyRole) }
