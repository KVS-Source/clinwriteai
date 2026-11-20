import { http, HttpResponse, delay } from 'msw'
import crmMeeting from '../../data/crmMeeting.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// Mirrors apps/api/src/modules/clinical-writing/crm/routes.ts so mock mode
// walks the same lifecycle: schedule → start → resolve → complete.
// Meetings live in memory per document; the fixture seeds an in-progress one
// (CMT-041 already resolved, CMT-042 + CMT-044 pending).

type Meeting = typeof crmMeeting & { status: string; endedAt?: string }
type Resolution = { id: string; meetingId: string; commentId: string; resolutionType: string; resolutionNote: string; resolvedBy: string; resolvedAt: string }

const meetingsByDoc = new Map<string, Meeting[]>()
const resolutionsByMeeting = new Map<string, Resolution[]>()

function seed(documentId: string): Meeting[] {
  const m: Meeting = {
    // Unique id per document — a shared fixture id made resolve/complete hit
    // whichever document's copy was seeded first.
    ...crmMeeting, id: `${crmMeeting.id}-${documentId}`, documentId, status: 'in_progress',
    pendingIds: crmMeeting.commentIds.filter(id => !crmMeeting.resolvedIds.includes(id)),
  }
  resolutionsByMeeting.set(m.id, crmMeeting.resolvedIds.map(commentId => ({
    id: `res-${commentId}`, meetingId: m.id, commentId, resolutionType: 'accept_with_modification',
    resolutionNote: 'CI will be amended to two decimal places throughout §11.4.', resolvedBy: 'user-MW', resolvedAt: crmMeeting.startedAt ?? new Date().toISOString(),
  })))
  return [m]
}
const meetingsFor = (documentId: string) => {
  if (!meetingsByDoc.has(documentId)) meetingsByDoc.set(documentId, seed(documentId))
  return meetingsByDoc.get(documentId)!
}
const findMeeting = (id: string) => {
  for (const list of meetingsByDoc.values()) { const m = list.find(x => x.id === id); if (m) return m }
  return undefined
}

export const crmHandlers = [
  http.get(`${BASE}/documents/:documentId/crm`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json(meetingsFor(String(params.documentId)))
  }),

  http.post(`${BASE}/documents/:documentId/crm`, async ({ request, params }) => {
    await delay(300)
    const documentId = String(params.documentId)
    const body = await request.json() as { chairId: string; scheduledDate: string; startTime: string; endTime: string }
    const m: Meeting = {
      ...crmMeeting, id: crypto.randomUUID(), documentId, meetingRef: `CRM-${String(meetingsFor(documentId).length + 1).padStart(3, '0')}`,
      date: body.scheduledDate, startTime: body.startTime, endTime: body.endTime, startedAt: undefined as unknown as string,
      status: 'scheduled', resolvedIds: [], activeId: null as unknown as string, pendingIds: [...crmMeeting.commentIds],
    }
    meetingsFor(documentId).push(m)
    resolutionsByMeeting.set(m.id, [])
    return HttpResponse.json(m, { status: 201 })
  }),

  http.post(`${BASE}/crm/:meetingId/start`, async ({ params }) => {
    await delay(200)
    const m = findMeeting(String(params.meetingId))
    if (!m) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    if (m.status !== 'scheduled' && m.status !== 'in_progress') return HttpResponse.json({ error: 'wrong_status', message: `Cannot start a ${m.status} meeting` }, { status: 409 })
    Object.assign(m, { status: 'in_progress', startedAt: m.startedAt ?? new Date().toISOString() })
    return HttpResponse.json(m)
  }),

  http.post(`${BASE}/crm/:meetingId/complete`, async ({ params }) => {
    await delay(200)
    const m = findMeeting(String(params.meetingId))
    if (!m) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    if (m.status !== 'in_progress') return HttpResponse.json({ error: 'wrong_status', message: `Cannot complete a ${m.status} meeting` }, { status: 409 })
    if (m.pendingIds.length > 0) {
      return HttpResponse.json({ error: 'comments_unresolved', message: `${m.pendingIds.length} open comment(s) unresolved in this meeting`, unresolvedCommentIds: m.pendingIds }, { status: 422 })
    }
    Object.assign(m, { status: 'complete', endedAt: new Date().toISOString() })
    return HttpResponse.json(m)
  }),

  http.get(`${BASE}/crm/:meetingId/resolutions`, async ({ params }) => {
    await delay(100)
    return HttpResponse.json(resolutionsByMeeting.get(String(params.meetingId)) ?? [])
  }),

  http.post(`${BASE}/crm/:meetingId/resolve`, async ({ request, params }) => {
    await delay(300)
    const m = findMeeting(String(params.meetingId))
    if (!m) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const body = await request.json() as { commentId: string; resolutionType: string; resolutionNote?: string }
    if (!body.resolutionNote) return HttpResponse.json({ error: 'validation', issues: [{ message: 'resolution note required (Part 11 audit)' }] }, { status: 400 })
    if (m.status !== 'in_progress') return HttpResponse.json({ error: 'wrong_status' }, { status: 409 })
    const resolution: Resolution = {
      id: crypto.randomUUID(), meetingId: m.id, commentId: body.commentId, resolutionType: body.resolutionType,
      resolutionNote: body.resolutionNote, resolvedBy: 'user-MW', resolvedAt: new Date().toISOString(),
    }
    resolutionsByMeeting.get(m.id)?.push(resolution)
    m.resolvedIds = [...new Set([...m.resolvedIds, body.commentId])]
    m.pendingIds = m.pendingIds.filter(id => id !== body.commentId)
    return HttpResponse.json(resolution, { status: 201 })
  }),
]
