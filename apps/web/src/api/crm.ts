import { api } from './client'
import type { CRMMeeting } from '@platform/types'

export const crmApi = {
  getMeetings: (documentId: string) =>
    api.get<CRMMeeting[]>(`/documents/${documentId}/crm`),
  createMeeting: (documentId: string, body: unknown) =>
    api.post<CRMMeeting>(`/documents/${documentId}/crm`, body),
  // The API's resolutionType enum is underscored ('accept_with_modification');
  // the UI's ResolutionType is hyphenated.
  logResolution: (meetingId: string, body: { resolutionType: string } & Record<string, unknown>) =>
    api.patch<unknown>(`/crm/${meetingId}/resolve`, {
      ...body, resolutionType: body.resolutionType.replace(/-/g, '_'),
    }),
}
