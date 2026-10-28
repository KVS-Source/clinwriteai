// React Query hooks for section-level presence.
//
// The snapshot query polls on a short interval; mutations auto-invalidate
// so UI avatars reflect joins/leaves immediately. Socket.io 'presence:changed'
// events (realtime plugin) are what the UI listens to for push updates;
// this hook is the authoritative-DB fallback that MSW mocks + the demo
// polling path both use.

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { presenceApi } from '../api'
import { ApiError } from '../api/client'

// Heartbeat cadence per API_Contracts §12 ("called every 15 seconds"). The
// server drops a session after PRESENCE_STALE_SECONDS (90s) without one.
const PRESENCE_HEARTBEAT_MS = 15_000

const snapshotKey = (documentId: string) => ['presence', documentId] as const

export function usePresenceSnapshot(documentId: string, opts: { pollMs?: number } = {}) {
  return useQuery({
    queryKey: snapshotKey(documentId),
    queryFn:  () => presenceApi.snapshot(documentId),
    enabled:  !!documentId,
    // 15s polling — matches the 90s PRESENCE_STALE_SECONDS window with a
    // 6x safety factor so a stale session is always visible by the time
    // the reaper closes it.
    refetchInterval: opts.pollMs ?? 15_000,
  })
}

export function useJoinPresence(documentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { sectionId: string; status?: 'active' | 'idle' }) =>
      presenceApi.join(documentId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKey(documentId) }),
  })
}

export function usePresenceHeartbeat(documentId: string, sessionId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { sectionId?: string; status?: 'active' | 'idle' } = {}) =>
      presenceApi.heartbeat(documentId, sessionId!, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKey(documentId) }),
  })
}

/**
 * Keeps this user's presence on a document live for as long as the editor is
 * open: joins on mount, heartbeats every 15s, reports section switches, and
 * leaves on unmount / tab close. A heartbeat answered 404/409 (the session was
 * closed — reaped as stale, or replaced when the same user joined from another
 * tab) re-joins.
 */
export function useDocumentPresence(documentId: string | undefined, sectionId: string | null | undefined) {
  const qc = useQueryClient()
  const sessionRef = useRef<string | null>(null)
  const sectionRef = useRef(sectionId)
  sectionRef.current = sectionId
  const joinRef = useRef<(() => Promise<void>) | null>(null)

  // Join / heartbeat loop / leave — one session per open document.
  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    let joining: Promise<void> | null = null
    const refresh = () => qc.invalidateQueries({ queryKey: snapshotKey(documentId) })

    const join = () => {
      const section = sectionRef.current
      if (!section) return Promise.resolve()
      joining ??= presenceApi.join(documentId, { sectionId: section, status: 'active' })
        .then(session => {
          if (cancelled) { void presenceApi.leave(documentId, session.id).catch(() => {}); return }
          sessionRef.current = session.id
          void refresh()
        })
        .catch(() => { /* retried on the next tick */ })
        .finally(() => { joining = null })
      return joining
    }
    joinRef.current = join

    const beat = async () => {
      const id = sessionRef.current
      if (!id) { await join(); return }
      try {
        await presenceApi.heartbeat(documentId, id, sectionRef.current ? { sectionId: sectionRef.current } : {})
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
          sessionRef.current = null
          await join()
        }
      }
    }

    const leave = () => {
      const id = sessionRef.current
      sessionRef.current = null
      if (id) void presenceApi.leave(documentId, id).catch(() => {})
    }

    void join()
    const timer = setInterval(() => { void beat() }, PRESENCE_HEARTBEAT_MS)
    window.addEventListener('pagehide', leave)
    return () => {
      cancelled = true
      joinRef.current = null
      clearInterval(timer)
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [documentId, qc])

  // Section switch — report it straight away (joins if the first join hadn't
  // happened yet because no section was picked).
  useEffect(() => {
    if (!documentId || !sectionId) return
    const id = sessionRef.current
    if (!id) { void joinRef.current?.(); return }
    void presenceApi.heartbeat(documentId, id, { sectionId })
      .then(() => qc.invalidateQueries({ queryKey: snapshotKey(documentId) }))
      .catch(() => {})
  }, [documentId, sectionId, qc])
}

export function useLeavePresence(documentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => presenceApi.leave(documentId, sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKey(documentId) }),
  })
}
