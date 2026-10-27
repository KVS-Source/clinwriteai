import { http, HttpResponse, delay } from 'msw'
import study    from '../../data/study.json'
import studyTB  from '../../data/studyTB.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const projects = [study, studyTB]

export const projectHandlers = [
  // Sample AI usage for mock mode (the real endpoint sums the project's AI call log).
  http.get(`${BASE}/reports/projects/:projectId/ai-usage`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json({
      projectId: params.projectId, calls: 38, failedCalls: 1, costUsd: 0.8423, inputTokens: 142_300, outputTokens: 31_800,
      avgLatencyMs: 4200, draftsGenerated: 30, draftsAccepted: 21, acceptanceRate: 0.7,
      byModel: [{ model: 'claude-opus-4-7', calls: 38, costUsd: 0.8423 }], generatedAt: new Date().toISOString(),
    })
  }),
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
