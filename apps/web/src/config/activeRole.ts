// Active role — a user who holds two roles works as one of them at a time and switches from the top
// bar (as in Genrac). The choice is remembered per browser, tied to the user it was made for, and the
// API client sends it on every request as X-Active-Role, so the server answers as that role too
// (apps/api/src/auth/active-role.ts). With no choice yet, the primary role is used.

const STORAGE_KEY = 'clinwrite.activeRole'

interface Stored { userId: string; role: string }

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    return typeof v?.userId === 'string' && typeof v?.role === 'string' ? { userId: v.userId, role: v.role } : null
  } catch { return null }
}

function write(v: Stored | null) {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable: the primary role is used */ }
}

/** Header for the API client: the role picked for this browser, if any. */
export function activeRoleHeader(): Record<string, string> {
  const v = typeof window === 'undefined' ? null : read()
  return v ? { 'X-Active-Role': v.role } : {}
}

/** Remember the role `userId` works as. The caller reloads so every screen and query starts over. */
export function chooseActiveRole(userId: string, role: string) { write({ userId, role }) }

export function clearActiveRole() { write(null) }

type WithRoles = { id: string; role: string; roles?: readonly string[] | null; allRoles?: readonly string[] | null }

/**
 * The user as they work now: `role` and `roles` narrowed to the active role, `allRoles` every role held
 * (primary first) for the switcher. A stored choice for another user, or for a role no longer held,
 * falls back to the primary role, and the result is remembered so the API is told the same.
 */
export function applyActiveRole<T extends WithRoles>(u: T): T & { allRoles: string[] } {
  const held = u.allRoles && u.allRoles.length > 0 ? [...u.allRoles] : u.roles && u.roles.length > 0 ? [...u.roles] : [u.role]
  if (held.length < 2) {
    const stored = read()
    if (stored && stored.userId === u.id) clearActiveRole()
    return { ...u, roles: held, allRoles: held }
  }
  const stored = read()
  const active = stored && stored.userId === u.id && held.includes(stored.role) ? stored.role : held[0]!
  if (!stored || stored.userId !== u.id || stored.role !== active) chooseActiveRole(u.id, active)
  return { ...u, role: active, roles: [active], allRoles: held }
}
