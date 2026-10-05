// React Query hooks for section-level presence.
//
// The snapshot query polls on a short interval; mutations auto-invalidate
// so UI avatars reflect joins/leaves immediately. Socket.io 'presence:changed'
// events (realtime plugin) are what the UI listens to for push updates;
// this hook is the authoritative-DB fallback that MSW mocks + the demo
// polling path both use.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { presenceApi } from '../api'

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

export function useLeavePresence(documentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => presenceApi.leave(documentId, sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKey(documentId) }),
  })
}
