import { http, HttpResponse, delay } from 'msw'
import crmMeeting from '../../data/crmMeeting.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const crmHandlers = [
  http.get(`${BASE}/documents/:documentId/crm`, async () => {
    await delay(150)
    return HttpResponse.json([crmMeeting])
  }),
  http.post(`${BASE}/documents/:documentId/crm`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    return HttpResponse.json({ ...crmMeeting, id: crypto.randomUUID(), documentId: params.documentId, meetingRef: 'CRM-001', status: 'in_progress', startedAt: new Date().toISOString(), resolvedIds: [], activeId: null, pendingIds: ['CMT-041', 'CMT-042', 'CMT-044'], ...body }, { status: 201 })
  }),
  http.patch(`${BASE}/crm/:meetingId/resolve`, async ({ request }) => {
    const body = await request.json() as { commentId: string; resolutionType: string; note: string }
    await delay(400)
    return HttpResponse.json({ meeting: { ...crmMeeting, resolvedIds: [...crmMeeting.resolvedIds, body.commentId] }, resolution: { id: crypto.randomUUID(), meetingId: crmMeeting.id, ...body, resolvedBy: 'user-MW', resolvedAt: new Date().toISOString() } })
  }),
]
