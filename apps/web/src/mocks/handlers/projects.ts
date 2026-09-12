import { http, HttpResponse, delay } from 'msw'
import study from '../../data/study.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const projects = [study]

export const projectHandlers = [
  http.get(`${BASE}/projects`, async () => {
    await delay(200)
    return HttpResponse.json(projects)
  }),
  http.get(`${BASE}/projects/:projectId`, async () => {
    await delay(150)
    return HttpResponse.json(study)
  }),
  http.post(`${BASE}/projects`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    return HttpResponse.json({ id: crypto.randomUUID(), status: 'initiated', activeModules: [], team: [], ...body }, { status: 201 })
  }),
]
