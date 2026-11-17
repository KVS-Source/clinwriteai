// Active role — a user who holds two roles works as one of them at a time and switches from the top
// bar (as in Genrac). The choice is remembered per browser, per user, and the API client sends it on
// every request as X-Active-Role, so the server answers as that role too (apps/api/src/auth/active-role.ts).
// With no choice yet, the primary role is used.
//
// Remembered per user, and only the current user's own choice is ever sent. (It used to be one shared slot:
// opening a second account in another tab, or switching persona, overwrote it, and the first tab then sent
// the other user's role, so the server answered as a role the screen wasn't showing.)

export const ACTIVE_ROLE_STORAGE_KEY = 'clinwrite.activeRole'
const STORAGE_KEY = ACTIVE_ROLE_STORAGE_KEY
// The demo persona picked for this tab (platformStore / api client use the same key).
const PERSONA_STORAGE_KEY = 'clinwrite.demo.currentUserId'

type Choices = Record<string, string>          // userId → role they work as

// The user this tab is signed in as, once known (set from /auth/me via applyActiveRole).
let currentUserId: string | null = null
// ...and remembered across reloads, so the very first request after a reload (before /auth/me answers) is
// already sent as the chosen role. Real sign-in is one session cookie per browser, so the last signed-in user
// is the right one; a demo persona (per tab) is checked first.
const LAST_USER_KEY = 'clinwrite.activeRole.user'

function rememberUser(id: string) {
  try { window.sessionStorage.setItem(LAST_USER_KEY, id); window.localStorage.setItem(LAST_USER_KEY, id) } catch { /* ignore */ }
}
function lastUser(): string | null {
  try { return window.sessionStorage.getItem(LAST_USER_KEY) ?? window.localStorage.getItem(LAST_USER_KEY) } catch { return null }
}
function forgetUser(id: string) {
  try {
    if (window.sessionStorage.getItem(LAST_USER_KEY) === id) window.sessionStorage.removeItem(LAST_USER_KEY)
    if (window.localStorage.getItem(LAST_USER_KEY) === id) window.localStorage.removeItem(LAST_USER_KEY)
  } catch { /* ignore */ }
}

function read(): Choices {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return {}
    // Older format: one { userId, role } for the whole browser.
    const old = v as { userId?: unknown; role?: unknown }
    if (typeof old.userId === 'string' && typeof old.role === 'string') return { [old.userId]: old.role }
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, r]) => typeof r === 'string')) as Choices
  } catch { return {} }
}

function write(c: Choices) {
  try {
    if (Object.keys(c).length > 0) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable: the primary role is used */ }
}

function personaIdForThisTab(): string | null {
  try { return window.sessionStorage.getItem(PERSONA_STORAGE_KEY) ?? window.localStorage.getItem(PERSONA_STORAGE_KEY) } catch { return null }
}

/** Header for the API client: the role this tab's user picked, if any. Never another user's choice. */
export function activeRoleHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const id = currentUserId ?? personaIdForThisTab() ?? lastUser()
  const role = id ? read()[id] : undefined
  return role ? { 'X-Active-Role': role } : {}
}

/** Remember the role `userId` works as. The caller reloads so every screen and query starts over. */
export function chooseActiveRole(userId: string, role: string) {
  currentUserId = userId
  write({ ...read(), [userId]: role })
}

/** Forget a user's choice (sign out). With no user given, forget this tab's user. */
export function clearActiveRole(userId: string | null = currentUserId ?? lastUser()) {
  if (!userId) return
  const c = read()
  delete c[userId]
  write(c)
}

/** Sign out: forget this tab's user and their choice, so the next person to sign in starts clean. */
export function forgetSignedInUser() {
  const id = currentUserId ?? lastUser()
  if (!id) return
  clearActiveRole(id)
  forgetUser(id)
  currentUserId = null
}

/** The role stored for `userId`, if any. */
export function storedActiveRole(userId: string): string | null {
  return typeof window === 'undefined' ? null : read()[userId] ?? null
}

/**
 * Keep the page on screen in step with the role the API is being told. The browser's Back button can show
 * a page from its back/forward cache exactly as it was left, i.e. still as the old role (e.g. the
 * Notification Centre mid-"Switching…" after a switch), and the same user switching in another tab changes
 * the stored role for this one too. Either way the screen would show one role while every request goes out
 * as another, so the page reloads as the role now in use. Another user's choice never triggers it.
 * Returns a cleanup function.
 */
export function watchActiveRole(userId: string, shownRole: string, heldRoles: readonly string[]): () => void {
  if (typeof window === 'undefined' || heldRoles.length < 2) return () => undefined
  const check = () => {
    const wanted = storedActiveRole(userId)
    if (wanted && wanted !== shownRole && heldRoles.includes(wanted)) window.location.reload()
  }
  const onShow = (e: PageTransitionEvent) => { if (e.persisted) check() }
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) check() }
  window.addEventListener('pageshow', onShow)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('pageshow', onShow)
    window.removeEventListener('storage', onStorage)
  }
}

type WithRoles = { id: string; role: string; roles?: readonly string[] | null; allRoles?: readonly string[] | null }

/**
 * The user as they work now: `role` and `roles` narrowed to the active role, `allRoles` every role held
 * (primary first) for the switcher. A stored choice for a role no longer held falls back to the primary
 * role, and the result is remembered so the API is told the same.
 */
export function applyActiveRole<T extends WithRoles>(u: T): T & { allRoles: string[] } {
  if (typeof window !== 'undefined') { currentUserId = u.id; rememberUser(u.id) }
  const held = u.allRoles && u.allRoles.length > 0 ? [...u.allRoles] : u.roles && u.roles.length > 0 ? [...u.roles] : [u.role]
  const stored = typeof window === 'undefined' ? null : storedActiveRole(u.id)
  if (held.length < 2) {
    if (stored) clearActiveRole(u.id)
    return { ...u, roles: held, allRoles: held }
  }
  const active = stored && held.includes(stored) ? stored : held[0]!
  if (stored !== active && typeof window !== 'undefined') chooseActiveRole(u.id, active)
  return { ...u, role: active, roles: [active], allRoles: held }
}
