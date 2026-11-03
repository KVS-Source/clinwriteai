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
