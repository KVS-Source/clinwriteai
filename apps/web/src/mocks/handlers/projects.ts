import { http, HttpResponse, delay } from 'msw'
import study    from '../../data/study.json'
import studyTB  from '../../data/studyTB.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const projects = [study, studyTB]

export const projectHandlers = [
  http.get(`${BASE}/projects`, async () => {
    await delay(200)
    return HttpResponse.json(projects)
  }),
  http.get(`${BASE}/projects/:projectId`, async ({ params }) => {
    await delay(150)
    const p = projects.find(x => x.id === params.projectId)
    return p
      ? HttpResponse.json(p)
      : HttpResponse.json({ error: 'not-found' }, { status: 404 })
  }),
  http.post(`${BASE}/projects`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    return HttpResponse.json({ id: crypto.randomUUID(), status: 'initiated', activeModules: [], team: [], ...body }, { status: 201 })
  }),
]
