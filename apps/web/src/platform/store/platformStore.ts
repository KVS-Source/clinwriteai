// Platform store — shared state across all sPM screens.
// Holds the current-user context (used by role guards) and platform-wide config.
import { create } from 'zustand'
import type { PlatformConfig, PlatformUser, PlatformUserRole } from '@platform/types'

// Demo current-user roster used by the AppShell top-nav + guards.
// The active user is set at boot (defaults to Dr James Hartley, Admin).
export const PLATFORM_DEMO_USERS: PlatformUser[] = [
  {
    id: 'user-admin', name: 'Dr James Hartley', email: 'j.hartley@genbioca.com',
    role: 'admin', modules: ['A', 'B', 'C', 'D', 'E'], status: 'active',
    lastActive: '2026-09-09T09:15:00Z',
  },
  {
    id: 'user-sa', name: 'Alex Thornton', email: 'a.thornton@clinwrite.ai',
    role: 'super-admin', modules: ['A', 'B', 'C', 'D', 'E'], status: 'active',
    lastActive: '2026-09-09T09:00:00Z',
  },
  {
    id: 'user-il', name: 'Ms Priya Nair', email: 'p.nair@genbioca.com',
    role: 'ideation-lead', modules: ['E'], status: 'active',
    lastActive: '2026-09-09T08:44:00Z',
  },
]

interface PlatformStore {
  currentUser:   PlatformUser
  config:        PlatformConfig | null
  setCurrentUser: (u: PlatformUser) => void
  setConfig:      (c: PlatformConfig | null) => void
  hasRole:       (roles: PlatformUserRole[]) => boolean
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  currentUser:  PLATFORM_DEMO_USERS[0],
  config:       null,
  setCurrentUser: (currentUser) => set({ currentUser }),
  setConfig:      (config)      => set({ config }),
  hasRole:        (roles)       => roles.includes(get().currentUser.role),
}))
