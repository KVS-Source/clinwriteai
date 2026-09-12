import { http, HttpResponse, delay } from 'msw'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const qaHandlers = [
  http.get(`${BASE}/documents/:documentId/qa-review`, async () => {
    await delay(100)
    return HttpResponse.json({ cadenceDays: 30, lastReviewedAt: '2024-09-28T00:00:00Z', lastReviewedBy: 'Dr. Linda Park', nextDueAt: '2024-10-28T00:00:00Z', isOverdue: true, daysOverdue: 0, reviewHistory: [] })
  }),
  http.post(`${BASE}/documents/:documentId/qa-review`, async () => {
    await delay(300)
    const nextDue = new Date()
    nextDue.setDate(nextDue.getDate() + 30)
    return HttpResponse.json({ auditEntryId: crypto.randomUUID(), nextDueAt: nextDue.toISOString() }, { status: 201 })
  }),
]
