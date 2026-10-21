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
}
