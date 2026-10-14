import { http, HttpResponse, delay } from 'msw'
import seed from '../../data/comments.json'
import team from '../../data/team.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// The mock signed-in user — the same person the mock GET /auth/me returns — so a
// comment is attributed to the person the screen says you are.
const me = team.find(u => u.initials === 'MW')!

type MockComment = (typeof seed)[number] & { resolutionNote?: string; resolvedBy?: string; resolvedAt?: string }

// Mock "database" for comments. Posted and resolved comments are kept in the
// browser's localStorage so they survive a page reload, like they would against
// the real API. Clear the site's data (or run `localStorage.removeItem(STORAGE_KEY)`)
// to get back to the seed data.
const STORAGE_KEY = 'clinwrite.mock.comments.v1'
const seedIds = new Set(seed.map(c => c.id))

interface Persisted { comments: MockComment[]; fresh: string[] }

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch { return null }     // storage blocked / corrupt → start from the seed
}

const persisted = loadPersisted()
const store: MockComment[] = persisted?.comments ?? seed.map(c => ({ ...c }))
// Seed comments added to the data file after this browser saved its copy still appear.
for (const c of seed) if (!store.some(s => s.id === c.id)) store.push({ ...c })
// Comments created in the UI get a live "just now / N min ago"; seed comments keep their demo ages.
const fresh = new Set<string>(persisted?.fresh ?? [])
let nextSeq = Math.max(...store.map(c => Number(c.id.replace('CMT-', '')) || 0)) + 1

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ comments: store, fresh: [...fresh] } satisfies Persisted)) }
  catch { /* storage blocked or full — the in-memory copy still works for this page load */ }
}

const ageOf = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export const commentHandlers = [
  http.get(`${BASE}/documents/:documentId/comments`, async ({ params }) => {
    await delay(150)
    // Seed comments show on every demo document (as before); comments created in
    // the UI belong to the document they were posted on.
    const rows = store
      .filter(c => seedIds.has(c.id) || c.documentId === params.documentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return HttpResponse.json(rows.map(c => (fresh.has(c.id) ? { ...c, age: ageOf(c.createdAt) } : c)))
  }),
  http.post(`${BASE}/documents/:documentId/comments`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(300)
    const createdAt = new Date().toISOString()
    const created = {
      id: `CMT-${String(nextSeq++).padStart(3, '0')}`,
      documentId: params.documentId as string,
      reviewerId: me.id, reviewerName: me.name, reviewerInitials: me.initials,
      status: 'open', createdAt, age: 'just now',
      ...body,
    } as MockComment
    store.push(created)
    fresh.add(created.id)
    persist()
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch(`${BASE}/documents/:documentId/comments/:commentId/resolve`, async ({ request, params }) => {
    const body = await request.json() as { resolutionType: string; note: string }
    await delay(300)
    const comment = store.find(c => c.id === params.commentId)
    if (!comment) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    if (comment.status === 'resolved') return HttpResponse.json({ error: 'conflict', message: 'Comment already resolved' }, { status: 409 })
    Object.assign(comment, { status: 'resolved', resolvedBy: 'user-MW', resolvedAt: new Date().toISOString(), resolutionNote: body.note })
    persist()
    return HttpResponse.json(comment)
  }),
]
