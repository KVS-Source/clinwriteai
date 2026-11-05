// Session sync — makes the SPA's notion of "who am I" come from the API.
//
// Before this, usePlatformStore.currentUser was always a hard-coded demo
// persona (Dr James Hartley, Admin), so a signed-in clinical-writer still saw
// admin menus and admin pages (which then 403'd). On mount we ask the API who
// the session belongs to (/auth/me) and put that user in the store.
//
// The result also drives AuthGuard when sign-in is real (AUTH_BYPASS off):
// 'signed-out' → /sign-in, mustChangePassword → /set-password. In bypass mode
// a failed lookup (offline prototype / MSW-only dev) keeps the demo persona so
// the prototype still works.

import { useEffect, useState } from 'react'
import type { PlatformUser, PlatformUserRole } from '@platform/types'
import { api } from '../../api/client'
import { AUTH_BYPASS } from '../../config/auth'
import { hasPersonaOverride, usePlatformStore } from './platformStore'

interface MeResponse {
  id: string
  email: string
  name: string
  role: PlatformUserRole
  roles?: PlatformUserRole[]
  modules: Array<'A' | 'B' | 'C' | 'D' | 'E'>
  status: PlatformUser['status']
  lastActiveAt: string | null
  tenantId?: string | null
  mustChangePassword?: boolean
}

export function toPlatformUser(me: MeResponse): PlatformUser {
  return {
    id: me.id,
    name: me.name,
    email: me.email,
    role: me.role,
    roles: me.roles ?? [me.role],
    modules: me.modules,
    status: me.status,
    lastActive: me.lastActiveAt,
    // Platform admin vs tenant admin is decided on this (null = platform).
    tenantId: me.tenantId ?? null,
  }
}

export type SessionStatus = 'pending' | 'signed-in' | 'signed-out'

// Module-level so every <AuthGuard> mount shares one request and a route
// change doesn't re-flash the loading state.
let settled = false
let inflight: Promise<void> | null = null
let status: SessionStatus = 'pending'
let mustChangePassword = false

function syncOnce(): Promise<void> {
  if (settled) return Promise.resolve()
  // A demo persona picked from the top-bar menu wins over the real session
  // (otherwise the switcher would be undone on its own reload). The menu has
  // a "use my real sign-in" action to drop the override. Bypass mode only —
  // with real sign-in the API ignores the persona header.
  if (AUTH_BYPASS && hasPersonaOverride()) { settled = true; status = 'signed-in'; return Promise.resolve() }
  inflight ??= api
    .get<MeResponse>('/auth/me', { on401: 'throw' })
    .then(me => {
      // Ignore anything that isn't a real user payload (e.g. a mock handler).
      if (me?.id && me?.role && Array.isArray(me.modules)) {
        usePlatformStore.getState().setSessionUser(toPlatformUser(me))
        status = 'signed-in'
        mustChangePassword = me.mustChangePassword === true
      } else {
        status = AUTH_BYPASS ? 'signed-in' : 'signed-out'
      }
    })
    .catch(() => {
      // No session / API down — bypass keeps the demo persona.
      status = AUTH_BYPASS ? 'signed-in' : 'signed-out'
    })
    .finally(() => { settled = true })
  return inflight
}

export interface SessionState {
  ready: boolean
  status: SessionStatus
  mustChangePassword: boolean
}

/** The session lookup's outcome; `ready` once it has finished (success or failure). */
export function useSession(): SessionState {
  const [ready, setReady] = useState(settled)
  useEffect(() => {
    if (settled) { setReady(true); return }
    let live = true
    void syncOnce().then(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])
  return { ready, status: ready ? status : 'pending', mustChangePassword: ready && mustChangePassword }
}

/** Returns true once the session lookup has finished (success or failure). */
export function useSessionSync(): boolean {
  return useSession().ready
}

// Test hook — reset module state between tests.
export function _resetSessionSync(): void {
  settled = false
  inflight = null
  status = 'pending'
  mustChangePassword = false
}
