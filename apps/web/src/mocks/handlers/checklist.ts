import { http, HttpResponse, delay } from 'msw'
import checklist from '../../data/checklist.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const checklistHandlers = [
  http.get(`${BASE}/documents/:documentId/checklist`, async () => {
    await delay(100)
    return HttpResponse.json(checklist)
  }),
  http.patch(`${BASE}/documents/:documentId/checklist/:itemId/complete`, async ({ request, params }) => {
    const body = await request.json() as { completedBy: string }
    await delay(200)
    const item = checklist.find(i => i.id === params.itemId)
    return HttpResponse.json({ ...item, status: 'complete', completedBy: body.completedBy, completedAt: new Date().toISOString() })
  }),
  http.patch(`${BASE}/documents/:documentId/checklist/:itemId/waive`, async ({ request, params }) => {
    const { waivedBy, reason } = await request.json() as { waivedBy: string; reason: string }
    await delay(300)
    const item = checklist.find(i => i.id === params.itemId)
    return HttpResponse.json({ ...item, status: 'waived', waivedBy, waivedAt: new Date().toISOString(), waiverReason: reason })
  }),
  http.post(`${BASE}/documents/:documentId/checklist`, async ({ request }) => {
    const body = await request.json() as { text: string; framework: string }
    await delay(200)
    return HttpResponse.json({ id: crypto.randomUUID(), templateItemId: null, frameworkMandatory: false, status: 'pending', isUserAdded: true, ...body }, { status: 201 })
  }),
]
