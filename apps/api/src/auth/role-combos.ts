// Which platform roles one user may hold together (docs/roles-and-permissions.md §2).
//
// A user holds one or two roles; their rights are the union (rbac.ts: hasAnyRole / onlyRolesIn).
// To keep separation of duties (21 CFR Part 11), some pairs are refused:
//   - an admin role is never combined with anything — an admin never authors, reviews or signs;
//   - Auditor + Contributor — an independent reviewer of the record doesn't author it;
//   - Guest has no account to add roles to.
// So the allowed pairs are Project Manager + Contributor and Project Manager + Auditor.

export const MAX_ROLES_PER_USER = 2

// Legacy role names count as their canonical role.
const CANONICAL: Record<string, string> = {
  admin: 'tenant-admin', 'super-admin': 'tenant-admin',
  'read-only': 'auditor',
  'clinical-writer': 'contributor', 'scientific-writer': 'contributor', 'medical-writer': 'contributor',
  'regulatory-writer': 'contributor', 'ideation-lead': 'contributor', reviewer: 'contributor',
}
export const canonicalRole = (role: string) => CANONICAL[role] ?? role

// Roles an admin may add as a user's second role.
export const ADDABLE_ROLES = ['tenant-admin', 'pm', 'contributor', 'auditor'] as const

export type RoleSetProblem =
  | { error: 'too_many_roles'; message: string }
  | { error: 'duplicate_role'; message: string }
  | { error: 'role_combination_not_allowed'; message: string }

const LABEL: Record<string, string> = { 'tenant-admin': 'Tenant admin', pm: 'Project manager', contributor: 'Contributor', auditor: 'Auditor', guest: 'Guest' }
const label = (r: string) => LABEL[canonicalRole(r)] ?? r

/** Why this set of roles can't be held together, or null when it can. */
export function roleSetProblem(roles: readonly string[]): RoleSetProblem | null {
  if (roles.length > MAX_ROLES_PER_USER) {
    return { error: 'too_many_roles', message: `A user can hold at most ${MAX_ROLES_PER_USER} roles. Revoke one before adding another.` }
  }
  const canon = roles.map(canonicalRole)
  if (new Set(canon).size !== canon.length) {
    return { error: 'duplicate_role', message: 'The user already holds this role.' }
  }
  if (canon.length < 2) return null
  const [a, b] = canon as [string, string]
  const pair = (x: string, y: string) => (a === x && b === y) || (a === y && b === x)
  if (canon.includes('tenant-admin')) {
    return { error: 'role_combination_not_allowed', message: 'A Tenant admin can’t hold another role: admins never author, review or sign.' }
  }
  if (canon.includes('guest')) {
    return { error: 'role_combination_not_allowed', message: 'A Guest can’t hold another role.' }
  }
  if (pair('auditor', 'contributor')) {
    return { error: 'role_combination_not_allowed', message: `${label(a)} and ${label(b)} can’t be held together: an auditor doesn’t author the record they review.` }
  }
  return null
}
