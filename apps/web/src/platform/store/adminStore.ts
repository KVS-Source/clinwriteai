// Admin store — client-organisation scoped state (sPM04, sPM06, sPM07, sPM13,
// sPM15, sPM17). Kept separate from Super Admin so a client Admin cannot
// accidentally receive Super Admin state slices via a shared store subscription.
import { create } from 'zustand'
import type {
  PlatformUser, RaciMatrix, PlatformNotification, NotificationPreference,
  AuditTrailEntry, Subscription, TATag, MasterLibraryItem, BestPractice,
} from '@platform/types'

interface AdminStore {
  users:                  PlatformUser[]
  raciMatrix:             RaciMatrix | null
  notifications:          PlatformNotification[]
  notificationPreferences: NotificationPreference[]
  auditTrail:             AuditTrailEntry[]
  subscription:           Subscription | null
  taTags:                 TATag[]
  masterLibrary:          MasterLibraryItem[]
  bestPractices:          BestPractice[]

  setUsers:                   (u: PlatformUser[]) => void
  upsertUser:                 (u: PlatformUser) => void
  setRaciMatrix:              (r: RaciMatrix | null) => void
  setNotifications:           (n: PlatformNotification[]) => void
  markNotificationRead:       (id: string) => void
  setNotificationPreferences: (p: NotificationPreference[]) => void
  setAuditTrail:              (a: AuditTrailEntry[]) => void
  setSubscription:            (s: Subscription | null) => void
  setTATags:                  (t: TATag[]) => void
  upsertTATag:                (t: TATag) => void
  setMasterLibrary:           (m: MasterLibraryItem[]) => void
  setBestPractices:           (b: BestPractice[]) => void
}

export const useAdminStore = create<AdminStore>(set => ({
  users:                  [],
  raciMatrix:             null,
  notifications:          [],
  notificationPreferences: [],
  auditTrail:             [],
  subscription:           null,
  taTags:                 [],
  masterLibrary:          [],
  bestPractices:          [],

  setUsers:                   (users)                   => set({ users }),
  upsertUser:                 (u)                       => set(s => ({
    users: s.users.some(x => x.id === u.id) ? s.users.map(x => x.id === u.id ? u : x) : [...s.users, u],
  })),
  setRaciMatrix:              (raciMatrix)              => set({ raciMatrix }),
  setNotifications:           (notifications)           => set({ notifications }),
  markNotificationRead:       (id)                      => set(s => ({
    notifications: s.notifications.map(n => n.id === id ? { ...n, isRead: true } : n),
  })),
  setNotificationPreferences: (notificationPreferences) => set({ notificationPreferences }),
  setAuditTrail:              (auditTrail)              => set({ auditTrail }),
  setSubscription:            (subscription)            => set({ subscription }),
  setTATags:                  (taTags)                  => set({ taTags }),
  upsertTATag:                (t)                       => set(s => ({
    taTags: s.taTags.some(x => x.id === t.id) ? s.taTags.map(x => x.id === t.id ? t : x) : [...s.taTags, t],
  })),
  setMasterLibrary:           (masterLibrary)           => set({ masterLibrary }),
  setBestPractices:           (bestPractices)           => set({ bestPractices }),
}))
