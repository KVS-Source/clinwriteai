import { http, HttpResponse, delay } from 'msw'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const presenceHandlers = [
  http.post(`${BASE}/documents/:documentId/presence`, async () => {
    await delay(50)
    return HttpResponse.json({ activeSessions: [
      { userId: 'user-MW', sectionId: '11.4', status: 'active', initials: 'MW', colourKey: 'MW' },
      { userId: 'user-JO', sectionId: '12.2', status: 'locked', initials: 'JO', colourKey: 'JO' },
      { userId: 'user-EV', sectionId: null,   status: 'idle',   initials: 'EV', colourKey: 'EV' },
    ]})
  }),
  http.delete(`${BASE}/documents/:documentId/presence`, async () => {
    await delay(50)
    return HttpResponse.json({})
  }),
]
