// Session sync — makes the SPA's notion of "who am I" come from the API.
//
// Before this, usePlatformStore.currentUser was always a hard-coded demo
// persona (Dr James Hartley, Admin), so a signed-in clinical-writer still saw
// admin menus and admin pages (which then 403'd). On mount we ask the API who
// the session belongs to (/auth/me) and put that user in the store.
//
// If the API is unreachable (offline prototype / MSW-only dev) we keep the
// demo persona so the prototype still works.

import { useEffect, useState } from 'react'
import type { PlatformUser, PlatformUserRole } from '@platform/types'
import { api } from '../../api/client'
import { hasPersonaOverride, usePlatformStore } from './platformStore'

interface MeResponse {
  id: string
  email: string
  name: string
  role: PlatformUserRole
  modules: Array<'A' | 'B' | 'C' | 'D' | 'E'>
  status: PlatformUser['status']
  lastActiveAt: string | null
}

export function toPlatformUser(me: MeResponse): PlatformUser {
  return {
    id: me.id,
    name: me.name,
    email: me.email,
    role: me.role,
    modules: me.modules,
    status: me.status,
    lastActive: me.lastActiveAt,
  }
}

// Module-level so every <AuthGuard> mount shares one request and a route
// change doesn't re-flash the loading state.
let settled = false
let inflight: Promise<void> | null = null

function syncOnce(): Promise<void> {
  if (settled) return Promise.resolve()
  // A demo persona picked from the top-bar menu wins over the real session
  // (otherwise the switcher would be undone on its own reload). The menu has
  // a "use my real sign-in" action to drop the override.
  if (hasPersonaOverride()) { settled = true; return Promise.resolve() }
  inflight ??= api
    .get<MeResponse>('/auth/me', { on401: 'throw' })
    .then(me => {
      // Ignore anything that isn't a real user payload (e.g. a mock handler).
      if (me?.id && me?.role && Array.isArray(me.modules)) {
        usePlatformStore.getState().setSessionUser(toPlatformUser(me))
      }
    })
    .catch(() => { /* no session / API down — keep the demo persona */ })
    .finally(() => { settled = true })
  return inflight
}

/** Returns true once the session lookup has finished (success or failure). */
export function useSessionSync(): boolean {
  const [ready, setReady] = useState(settled)
  useEffect(() => {
    if (settled) { setReady(true); return }
    let live = true
    void syncOnce().then(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])
  return ready
}

// Test hook — reset module state between tests.
export function _resetSessionSync(): void {
  settled = false
  inflight = null
}
