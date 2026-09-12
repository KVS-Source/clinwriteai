import { http, HttpResponse, delay } from 'msw'
import auditTrail from '../../data/auditTrail.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const auditHandlers = [
  http.get(`${BASE}/documents/:documentId/audit`, async () => {
    await delay(200)
    return HttpResponse.json({ entries: auditTrail, total: auditTrail.length, limit: 50, offset: 0 })
  }),
]
