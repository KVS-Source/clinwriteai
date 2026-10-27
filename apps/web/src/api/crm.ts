import { api } from './client'
import type { CRMMeeting } from '@platform/types'

// Comments Resolution Meeting (PRD stage 5). Lifecycle, matching
// apps/api/src/modules/clinical-writing/crm/routes.ts:
//   schedule (POST /documents/:id/crm) → start (doc → crm_in_progress)
//   → log a resolution per open comment → complete (doc → pending_signature)

export interface ScheduleMeetingBody {
  chairId: string
  scheduledDate: string            // ISO datetime
  startTime: string                // e.g. '15:00 IST'
  endTime: string
  attendees: Array<{ userId: string; roleInCrm: 'Chair' | 'Author' | 'Reviewer' | 'Observer' }>
}

export interface CRMResolutionRow {
  id: string
  meetingId: string
  commentId: string
  resolutionType: 'accept' | 'accept_with_modification' | 'reject'
  resolutionNote: string
  resolvedBy: string
  resolvedAt: string
}

export const crmApi = {
  getMeetings: (documentId: string) =>
    api.get<CRMMeeting[]>(`/documents/${documentId}/crm`),
  createMeeting: (documentId: string, body: ScheduleMeetingBody) =>
    api.post<CRMMeeting>(`/documents/${documentId}/crm`, body),
  startMeeting: (meetingId: string) =>
    api.post<unknown>(`/crm/${meetingId}/start`, {}),
  /** End the meeting. Refused (422 comments_unresolved) while real comments are open. */
  completeMeeting: (meetingId: string) =>
    api.post<unknown>(`/crm/${meetingId}/complete`, {}),
  listResolutions: (meetingId: string) =>
    api.get<CRMResolutionRow[]>(`/crm/${meetingId}/resolutions`),
  // POST /crm/:meetingId/resolve (the API has no PATCH route). The API's
  // resolutionType enum is underscored ('accept_with_modification') while the
  // UI's ResolutionType is hyphenated, and it requires the note as
  // `resolutionNote` (the panel sends `note`).
  logResolution: (meetingId: string, body: { resolutionType: string; note?: string } & Record<string, unknown>) => {
    const { note, ...rest } = body
    return api.post<unknown>(`/crm/${meetingId}/resolve`, {
      ...rest,
      resolutionType: body.resolutionType.replace(/-/g, '_'),
      resolutionNote: (body.resolutionNote as string | undefined) ?? note ?? '',
    })
  },

  // --- AI Note-Taker (Phase 1 — sPM-ai-notetaker) --------------------------
  // Audio is never stored. The chair pastes a pre-transcribed text (Zoom
  // "Save transcript" / Teams export / Otter for now; Recall.ai bot in
  // Phase 3). The server extracts per-comment draft notes and can also
  // generate a minutes HTML.
  uploadTranscript: (meetingId: string, body: { rawText: string; source?: 'manual_paste' | 'zoom_native' | 'teams_export' | 'otter' | 'bot' }) =>
    api.post<{
      transcript: { id: string; meetingId: string; wordCount: number; source: string; uploadedBy: string; uploadedAt: string }
      drafts: number
      aiModel: string
    }>(`/crm/${meetingId}/transcript`, body),
  getAiDrafts: (meetingId: string) =>
    api.get<{
      meetingId: string
      drafts: Array<{ commentId: string; draftText: string; aiModel: string; generatedAt: string }>
      transcript: { wordCount: number; source: string; uploadedAt: string } | null
    }>(`/crm/${meetingId}/ai-drafts`),
  generateMinutes: (meetingId: string) =>
    api.post<{ meetingId: string; minutesHtml: string; generatedAt: string | null }>(
      `/crm/${meetingId}/minutes`, {},
    ),
}
