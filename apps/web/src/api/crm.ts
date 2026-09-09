import { api } from './client'
import type { CRMMeeting } from '@platform/types'

export const crmApi = {
  getMeetings: (documentId: string) =>
    api.get<CRMMeeting[]>(`/documents/${documentId}/crm`),
  createMeeting: (documentId: string, body: unknown) =>
    api.post<CRMMeeting>(`/documents/${documentId}/crm`, body),
  logResolution: (meetingId: string, body: unknown) =>
    api.patch<unknown>(`/crm/${meetingId}/resolve`, body),
}
