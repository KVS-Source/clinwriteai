import { http, HttpResponse, delay } from 'msw'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const voiceNoteHandlers = [
  http.get(`${BASE}/documents/:documentId/voice-notes`, async () => {
    await delay(100)
    return HttpResponse.json([])
  }),
  http.post(`${BASE}/documents/:documentId/voice-notes`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    return HttpResponse.json({ id: crypto.randomUUID(), documentId: params.documentId, audioRef: 'blob:mock-audio-url', audioRegion: 'us-east-1', transcriptStatus: 'complete', createdAt: new Date().toISOString(), insertedAt: null, ...body }, { status: 201 })
  }),
]
