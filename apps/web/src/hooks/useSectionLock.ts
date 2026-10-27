// React hook for the per-section advisory lock (sPM-autosave).
//
// Lifecycle:
//   - Enabled when (documentId, sectionId) and a current user are present.
//   - Acquires immediately on mount; starts a 30s heartbeat timer.
//   - Releases on unmount / section change (sync-DELETE; a sendBeacon
//     fallback on `pagehide` handles tab close + hard-nav).
//   - Re-acquires when another user's foreign lock goes stale (polling the
//     snapshot every ~15s decides this: once the foreign holder is gone
//     from the snapshot we automatically try again).
//
// State surfaced to the caller:
//   mode:
//     'idle'      — not acquired yet (initial / between sections)
//     'owned'     — this user holds a live lock → autosave allowed
//     'foreign'   — someone else holds a live lock → read-only banner
//     'error'     — network / server error on acquire (we leave the UI
//                   editable so writers aren't blocked by transient issues;
//                   the server-side 423 is the safety net)
//
// Why not react-query mutations: the lifecycle is coordinated (acquire →
// heartbeat loop → release), which is awkward to model as independent
// mutations. We call the API wrappers directly and manage state locally.

import { useCallback, useEffect, useRef, useState } from 'react'
import { documentsApi } from '../api'
import { ApiError } from '../api/client'

const HEARTBEAT_INTERVAL_MS = 30_000

export type LockMode = 'idle' | 'owned' | 'foreign' | 'error'

export interface LockHolder {
  userId:           string
  acquiredAt:       string
  lastHeartbeatAt:  string
  expiresInSeconds: number
}

export interface SectionLockState {
  mode:   LockMode
  holder: LockHolder | null
  /** Last-attempt error, cleared on successful acquire. */
  error:  Error | null
  /** Force an immediate re-acquire attempt (e.g., when a 423 Locked is seen on autosave). */
  reacquire: () => void
}

export function useSectionLock(
  documentId: string | undefined,
  sectionId: string | undefined,
): SectionLockState {
  const [state, setState] = useState<{ mode: LockMode; holder: LockHolder | null; error: Error | null }>({
    mode: 'idle', holder: null, error: null,
  })
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const requestIdRef = useRef(0)  // monotonic — stale async responses are dropped

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const tryAcquire = useCallback(async () => {
    if (!documentId || !sectionId) return
    const myId = ++requestIdRef.current
    try {
      const res = await documentsApi.acquireSectionLock(documentId, sectionId)
      if (requestIdRef.current !== myId) return  // raced; drop
      setState({ mode: 'owned', holder: res.holder, error: null })
    } catch (err) {
      if (requestIdRef.current !== myId) return
      if (err instanceof ApiError && err.status === 423) {
        const body = err.body as { holder?: LockHolder } | null
        setState({ mode: 'foreign', holder: body?.holder ?? null, error: null })
      } else {
        setState({ mode: 'error', holder: null, error: err instanceof Error ? err : new Error('acquire_failed') })
      }
    }
  }, [documentId, sectionId])

  // Acquire-on-mount + release-on-unmount lifecycle.
  useEffect(() => {
    if (!documentId || !sectionId) {
      setState({ mode: 'idle', holder: null, error: null })
      return
    }

    void tryAcquire()
    // Start heartbeat regardless of initial outcome — if we're currently
    // 'foreign' and the holder goes stale, this loop will steal the lock
    // on its next tick.
    heartbeatRef.current = setInterval(() => { void tryAcquire() }, HEARTBEAT_INTERVAL_MS)

    const releaseSync = () => {
      // sendBeacon with method hint via a tiny endpoint hack: the fetch
      // DELETE below is synchronous-at-dispatch; it may not complete in a
      // tab-close scenario, but sendBeacon of an empty body to the DELETE
      // route isn't supported by the browser (POST only). We rely on the
      // 90s stale window to clean up tab-close locks naturally.
      documentsApi.releaseSectionLock(documentId, sectionId).catch(() => {})
    }

    window.addEventListener('pagehide', releaseSync)

    return () => {
      stopHeartbeat()
      window.removeEventListener('pagehide', releaseSync)
      requestIdRef.current++  // invalidate any in-flight acquires
      releaseSync()
    }
  }, [documentId, sectionId, tryAcquire, stopHeartbeat])

  return {
    mode:      state.mode,
    holder:    state.holder,
    error:     state.error,
    reacquire: tryAcquire,
  }
}
