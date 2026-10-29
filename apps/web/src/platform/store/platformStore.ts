// Platform store — shared state across all sPM screens.
// Holds the current-user context (used by role guards) and platform-wide config.
import { create } from 'zustand'
import type { PlatformConfig, PlatformUser, PlatformUserRole } from '@platform/types'
import usersFixture from '../../data/users.json'

// Full demo persona roster — Alex Thornton is synthetic (not in the
// users.json fixture) so prepend her so the switcher always has a PM
// persona to switch into. The SUPER_ADMIN variable name is historical
// (she was the super-admin pre-2026-10-27); her role was consolidated to
// 'admin' at that point and flipped to 'pm' when the canonical post-mig-48
// Project Manager role shipped. Kept the variable name to minimise churn
// — all consumers reference PLATFORM_DEMO_USERS, not SUPER_ADMIN directly.
const CLIENT_USERS = usersFixture as PlatformUser[]

const SUPER_ADMIN: PlatformUser = {
  id:         'user-sa',
  name:       'Alex Thornton',
  email:      'a.thornton@clinwrite.ai',
  role:       'pm',
  modules:    ['A', 'B', 'C', 'D', 'E'],
  status:     'active',
  lastActive: '2026-09-09T09:00:00Z',
}

export const PLATFORM_DEMO_USERS: PlatformUser[] = [SUPER_ADMIN, ...CLIENT_USERS]

const DEFAULT_USER_ID  = 'user-admin'   // Dr James Hartley — all-modules Admin
const STORAGE_KEY      = 'clinwrite.demo.currentUserId'
// Note: apps/web/src/api/client.ts reads STORAGE_KEY directly to send the
// user id on X-Demo-Persona, so no separate persist step is needed here.

// The persona is pinned per tab (sessionStorage); localStorage only seeds new
// tabs. Reading localStorage on every request let a persona switch in one tab
// silently change who another open tab is — two "different users" in one
// browser became the same user, so section locks never conflicted.
function readPersonaId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const id = window.sessionStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY)
    if (id) window.sessionStorage.setItem(STORAGE_KEY, id)
    return id
  } catch { return null }
}

function loadPersistedUser(): PlatformUser {
  const id = readPersonaId()
  if (id) {
    const found = PLATFORM_DEMO_USERS.find(u => u.id === id)
    if (found) return found
  }
  return PLATFORM_DEMO_USERS.find(u => u.id === DEFAULT_USER_ID) ?? PLATFORM_DEMO_USERS[0]
}

/** True when the user deliberately picked a demo persona from the top-bar menu. */
export function hasPersonaOverride(): boolean {
  const id = readPersonaId()
  return !!id && PLATFORM_DEMO_USERS.some(u => u.id === id)
}

/** Forget the demo persona so the real signed-in user is used again. */
export function clearPersonaOverride() {
  try {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

function persistUser(u: PlatformUser) {
  try {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(STORAGE_KEY, u.id)
    window.localStorage.setItem(STORAGE_KEY, u.id)
  } catch { /* ignore */ }
}

interface PlatformStore {
  currentUser:    PlatformUser
  config:         PlatformConfig | null
  setCurrentUser: (u: PlatformUser) => void
  /** Sets the user resolved from the API session. Not persisted: the
   *  real session, not localStorage, decides who you are on reload. */
  setSessionUser: (u: PlatformUser) => void
  setConfig:      (c: PlatformConfig | null) => void
  hasRole:        (roles: PlatformUserRole[]) => boolean
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  currentUser:    loadPersistedUser(),
  config:         null,
  setCurrentUser: (currentUser) => { persistUser(currentUser); set({ currentUser }) },
  setSessionUser: (currentUser) => set({ currentUser }),
  setConfig:      (config)      => set({ config }),
  hasRole:        (roles)       => roles.includes(get().currentUser.role),
}))
