// Section-level presence wrappers.
// Shape matches API §10 (apps/api/src/modules/clinical-writing/presence/routes.ts).
//
// Companion to the Socket.io 'presence:changed' event — clients re-fetch
// the snapshot from GET /presence when the socket fires. Keeps the DB
// authoritative; eliminates socket↔DB consistency gap.

import { api } from './client'

export interface PresenceSession {
  id: string
  documentId: string
  userId: string
  sectionId: string
  status: 'active' | 'idle' | 'ended'
  startedAt: string
  heartbeatAt: string
  endedAt: string | null
}

export interface PresenceSnapshot {
  documentId: string
  staleSeconds: number
  sections: Array<{
    sectionId: string
    users: Array<{
      sessionId: string
      userId: string
      status: 'active' | 'idle' | 'ended'
      startedAt: string
      heartbeatAt: string
    }>
  }>
  generatedAt: string
}

export const presenceApi = {
  join: (documentId: string, body: { sectionId: string; status?: 'active' | 'idle' }) =>
    api.post<PresenceSession>(`/documents/${documentId}/presence`, body),

  heartbeat: (documentId: string, sessionId: string, body: { sectionId?: string; status?: 'active' | 'idle' } = {}) =>
    api.patch<PresenceSession>(`/documents/${documentId}/presence/${sessionId}/heartbeat`, body),

  leave: (documentId: string, sessionId: string) =>
    api.delete<PresenceSession>(`/documents/${documentId}/presence/${sessionId}`),

  snapshot: (documentId: string) =>
    api.get<PresenceSnapshot>(`/documents/${documentId}/presence`),
}
