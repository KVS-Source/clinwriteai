import { http, HttpResponse, delay } from 'msw'
import tlf from '../../data/tlf.json'
import meddra from '../../data/meddra.json'
import ichSections from '../../data/ichSections.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const referenceHandlers = [
  http.get(`${BASE}/documents/:documentId/tlf`, async () => {
    await delay(150)
    return HttpResponse.json(tlf)
  }),
  http.get(`${BASE}/meddra/search`, async ({ request }) => {
    const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''
    await delay(300)
    const results = q.length >= 3
      ? meddra.searchResults.filter(t => t.pt.toLowerCase().includes(q) || t.soc.toLowerCase().includes(q))
      : []
    return HttpResponse.json({ version: meddra.version, results })
  }),
  http.get(`${BASE}/documents/:documentId/ich-e3`, async () => {
    await delay(100)
    const complete = ichSections.filter(s => s.status === 'complete').length
    return HttpResponse.json({ completionPercent: Math.round((complete / ichSections.length) * 100), completeSections: complete, totalSections: ichSections.length, sections: ichSections })
  }),
]
