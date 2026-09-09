import { http, HttpResponse, delay } from 'msw'
import team from '../../data/team.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export const authHandlers = [
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const { email } = await request.json() as { email: string }
    const user = team.find(u => u.email === email)
    await delay(400)
    if (!user) return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    return HttpResponse.json({ sessionToken: 'mock-session-token', requiresMFA: true, user })
  }),
  http.post(`${BASE}/auth/mfa`, async ({ request }) => {
    const { code } = await request.json() as { code: string }
    await delay(300)
    if (!/^\d{6}$/.test(code)) return HttpResponse.json({ error: 'Invalid MFA code' }, { status: 401 })
    return HttpResponse.json({ sessionToken: 'mock-full-session-token' })
  }),
  http.get(`${BASE}/auth/me`, async () => {
    await delay(100)
    return HttpResponse.json(team.find(u => u.initials === 'MW'))
  }),
  http.post(`${BASE}/auth/logout`, async () => {
    await delay(100)
    return HttpResponse.json({})
  }),
]
