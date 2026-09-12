// Platform store — shared state across all sPM screens.
// Holds the current-user context (used by role guards) and platform-wide config.
import { create } from 'zustand'
import type { PlatformConfig, PlatformUser, PlatformUserRole } from '@platform/types'
import usersFixture from '../../data/users.json'

// Full demo persona roster — Alex Thornton (Super Admin, GenBioCa-internal) is
// synthetic since she's not a client-org user, so prepend her to the fixture.
const CLIENT_USERS = usersFixture as PlatformUser[]

const SUPER_ADMIN: PlatformUser = {
  id:         'user-sa',
  name:       'Alex Thornton',
  email:      'a.thornton@clinwrite.ai',
  role:       'super-admin',
  modules:    ['A', 'B', 'C', 'D', 'E'],
  status:     'active',
  lastActive: '2026-09-09T09:00:00Z',
}

export const PLATFORM_DEMO_USERS: PlatformUser[] = [SUPER_ADMIN, ...CLIENT_USERS]

const DEFAULT_USER_ID  = 'user-admin'   // Dr James Hartley — all-modules Admin
const STORAGE_KEY      = 'clinwrite.demo.currentUserId'

function loadPersistedUser(): PlatformUser {
  try {
    const id = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (id) {
      const found = PLATFORM_DEMO_USERS.find(u => u.id === id)
      if (found) return found
    }
  } catch { /* localStorage unavailable — fall through to default */ }
  return PLATFORM_DEMO_USERS.find(u => u.id === DEFAULT_USER_ID) ?? PLATFORM_DEMO_USERS[0]
}

function persistUser(u: PlatformUser) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, u.id)
  } catch { /* ignore */ }
}

interface PlatformStore {
  currentUser:    PlatformUser
  config:         PlatformConfig | null
  setCurrentUser: (u: PlatformUser) => void
  setConfig:      (c: PlatformConfig | null) => void
  hasRole:        (roles: PlatformUserRole[]) => boolean
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  currentUser:    loadPersistedUser(),
  config:         null,
  setCurrentUser: (currentUser) => { persistUser(currentUser); set({ currentUser }) },
  setConfig:      (config)      => set({ config }),
  hasRole:        (roles)       => roles.includes(get().currentUser.role),
}))
