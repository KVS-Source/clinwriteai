import { http, HttpResponse, delay } from 'msw'
import comments from '../../data/comments.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const commentHandlers = [
  http.get(`${BASE}/documents/:documentId/comments`, async () => {
    await delay(150)
    return HttpResponse.json(comments)
  }),
  http.post(`${BASE}/documents/:documentId/comments`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(300)
    return HttpResponse.json({ id: `CMT-0${String(comments.length + 45).padStart(2, '0')}`, documentId: params.documentId, reviewerId: 'user-EV', reviewerName: 'Dr. Elena Vasquez', reviewerInitials: 'EV', status: 'open', createdAt: new Date().toISOString(), age: 'Just now', ...body }, { status: 201 })
  }),
  http.patch(`${BASE}/documents/:documentId/comments/:commentId/resolve`, async ({ request, params }) => {
    const body = await request.json() as { resolutionType: string; note: string }
    await delay(300)
    const comment = comments.find(c => c.id === params.commentId)
    return HttpResponse.json({ ...comment, status: 'resolved', resolvedBy: 'user-MW', resolvedAt: new Date().toISOString(), resolutionNote: body.note })
  }),
]
