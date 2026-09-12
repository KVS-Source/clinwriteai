import { http, HttpResponse, delay } from 'msw'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const aiHandlers = [
  http.post(`${BASE}/documents/:documentId/ai-suggest`, async () => {
    await delay(1200)
    return HttpResponse.json({
      text: 'The Kaplan–Meier analysis demonstrated robust separation of PFS curves between the Veloricept combination arm and control from Week 8, with the hazard ratio of 0.61 indicating a 39% reduction in the risk of progression or death.',
      sources: ['Table 14.2.1', 'SAP v2.0 §6.3', 'KM Analysis Dataset'],
      model: 'claude-sonnet',
      generatedAt: new Date().toISOString(),
    })
  }),
  http.post(`${BASE}/documents/:documentId/ai-accept`, async ({ params }) => {
    await delay(200)
    return HttpResponse.json({ id: params.documentId, updatedAt: new Date().toISOString() })
  }),
]
