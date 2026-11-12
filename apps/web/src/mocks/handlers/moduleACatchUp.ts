// Mock handlers for the Clinical Writing calls the web client makes that had no mock (CW-050): mock mode
// had fallen behind the live API, so those calls fell through to the real API (or failed). Same rules as the
// other handlers: in memory, resets on reload, shapes typed against the client's own response types so a
// drift shows up as a type error. Behaviour copies the live API where it matters (RACI rows, the Reviewer
// line, the chain lock) and stays simple where it doesn't (audit, locks, presence).

import { http, HttpResponse, delay } from 'msw'
import documents from '../../data/documents.json'
import users from '../../data/users.json'
import signatureChain from '../../data/signatureChain.json'
import type { DocumentRaciRow, RaciLetter, AssignableUser, ProjectMember, PendingPerson } from '../../api/raci'
import type { CrmPerson } from '../../api/crm'
import type { PresenceSnapshot, PresenceSession } from '../../api/presence'
import type { AiDraftStatusResponse } from '../../api/ai-drafter'
import type { PmDirectoryEntry, ProjectManagerRow } from '../../api/projects'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const json = (body: unknown, status = 200) => HttpResponse.json(body as never, { status })
const NOW = () => new Date().toISOString()
const ME = 'user-admin'
const person = (id: string) => users.find(u => u.id === id)
const nameOf = (id: string) => person(id)?.name ?? id
const initialsOf = (id: string) => nameOf(id).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const docOf = (id: unknown) => documents.find(d => d.id === id) ?? documents[0]!

// ---------- RACI (per document, seeded once from the document's assignee) ----------

const raciByDoc = new Map<string, DocumentRaciRow[]>()
let raciSeq = 1
function raciRows(documentId: string): DocumentRaciRow[] {
  let rows = raciByDoc.get(documentId)
  if (!rows) {
    const doc = docOf(documentId)
    const row = (userId: string, letter: RaciLetter): DocumentRaciRow => ({
      id: `raci-${raciSeq++}`, documentId, userId, letter, sectionId: null, approvalOrder: null, signatureRequired: false, signatureMeaning: null,
      submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null,
      assignedBy: ME, assignedAt: NOW(), removedAt: null, userName: nameOf(userId),
    })
    rows = [row(doc.assigneeId, 'R'), row('user-EV', 'C'), row('user-JO', 'A')].filter(r => person(r.userId))
    raciByDoc.set(documentId, rows)
  }
  return rows
}
const chainActive = () => (signatureChain as Array<{ status: string }>).some(s => s.status === 'awaiting' || s.status === 'queued')
const cohortFor = (rows: DocumentRaciRow[], letter: RaciLetter) => rows.filter(r => !r.removedAt && r.letter === letter)

// Reviewer line (see apps/api/.../document-raci/review-order.ts): a C waits for lower places that haven't finished.
const reviewersAhead = (rows: DocumentRaciRow[], userId: string) => {
  const mine = rows.filter(r => !r.removedAt && r.letter === 'C' && r.userId === userId && r.approvalOrder !== null).map(r => r.approvalOrder as number)
  if (mine.length === 0) return [] as string[]
  const place = Math.min(...mine)
  return [...new Set(rows.filter(r => !r.removedAt && r.letter === 'C' && r.userId !== userId && r.approvalOrder !== null && r.approvalOrder < place && !r.reviewedAt).map(r => r.userId))]
}

// ---------- Projects: people, managers, status ----------

const MANAGERS: ProjectManagerRow[] = [{ id: ME, name: nameOf(ME), email: person(ME)?.email ?? '', status: 'active', addedBy: ME, addedAt: NOW(), isCreator: true }]
const members: ProjectMember[] = []
const projectStatus = new Map<string, string>()
const NEXT: Record<string, string[]> = { initiated: ['ongoing', 'on-hold', 'closed'], ongoing: ['on-hold', 'closed'], 'on-hold': ['ongoing', 'closed'], closed: ['ongoing'] }

// ---------- Presence ----------

const sessions = new Map<string, PresenceSession>()

// Must be registered BEFORE the generic GET /projects/:projectId (it would take "pm-directory" for an id).
export const pmDirectoryHandlers = [
  http.get(`${BASE}/projects/pm-directory`, async () => {
    const body: PmDirectoryEntry[] = users.filter(u => u.role === 'pm' || u.role === 'admin').map(u => ({ id: u.id, name: u.name, email: u.email, status: u.status }))
    return json(body)
  }),
]

export const moduleACatchUpHandlers = [
  // --- AI drafting status (never AI-drafted in mock mode)
  http.get(`${BASE}/documents/:documentId/ai-draft-status`, async () => {
    const body: AiDraftStatusResponse = { aiStubMode: false, state: null, confidenceOverall: null, lastPassNumber: null, lastPassAt: null, sections: [], passes: [] }
    return json(body)
  }),

  // --- Presence
  http.get(`${BASE}/documents/:documentId/presence`, async ({ params }) => {
    const body: PresenceSnapshot = { documentId: String(params.documentId), staleSeconds: 90, sections: [], generatedAt: NOW() }
    return json(body)
  }),
  http.patch(`${BASE}/documents/:documentId/presence/:sessionId/heartbeat`, async ({ params }) => {
    const s = sessions.get(String(params.sessionId))
    return s ? json({ ...s, heartbeatAt: NOW() }) : json({ error: 'not_found' }, 404)
  }),
  http.delete(`${BASE}/documents/:documentId/presence/:sessionId`, async ({ params }) => {
    const s = sessions.get(String(params.sessionId))
    if (!s) return json({ error: 'not_found' }, 404)
    sessions.delete(s.id)
    return json({ ...s, status: 'ended', endedAt: NOW() })
  }),

  // --- Stage, versions, template, deadlines, locks, protocol metadata
  http.get(`${BASE}/documents/:documentId/stage`, async ({ params }) => {
    const d = docOf(params.documentId)
    return json({ documentId: d.id, current: d.stage, currentLabel: d.stage, next: null, nextLabel: null, terminal: false })
  }),
  http.post(`${BASE}/documents/:documentId/advance-stage`, async ({ params }) => json(docOf(params.documentId))),
  http.post(`${BASE}/documents/:documentId/versions`, async ({ request }) => {
    const b = await request.json().catch(() => ({})) as { label?: string }
    return json({ id: `ver-${Date.now()}`, versionNumber: 'v0.5', label: b.label ?? 'Draft', createdBy: ME, createdByName: nameOf(ME), createdAt: NOW(), isCurrent: true, contentHash: 'mock' }, 201)
  }),
  http.post(`${BASE}/documents/:documentId/apply-template`, async () => json({ sectionCount: 18 })),
  http.patch(`${BASE}/documents/:documentId/protocol-metadata`, async ({ params }) => json(docOf(params.documentId))),
  http.patch(`${BASE}/documents/:documentId/target-date`, async ({ request }) => {
    const b = await request.json() as { date: string | null }
    return json({ targetCompletionDate: b.date ? `${b.date}T00:00:00.000Z` : null })
  }),
  http.patch(`${BASE}/documents/:documentId/review-due-date`, async ({ request }) => {
    const b = await request.json() as { date: string }
    return json({ reviewDueAt: `${b.date}T00:00:00.000Z` })
  }),
  http.get(`${BASE}/documents/:documentId/locks`, async () => json([])),
  http.delete(`${BASE}/documents/:documentId/sections/:sectionId/lock`, async () => new HttpResponse(null, { status: 204 })),
  http.get(`${BASE}/documents/:documentId/final`, async ({ params }) => json(docOf(params.documentId))),

  // --- Checklist (new endpoints)
  http.get(`${BASE}/projects/:projectId/checklist-summary`, async () => json({ items: [], totals: { complete: 0, pending: 0, waived: 0 } })),
  http.get(`${BASE}/documents/:documentId/checklist/template-update`, async () => json({ available: null })),
  http.post(`${BASE}/documents/:documentId/checklist/adopt-template`, async () => json({ error: 'no_update', message: 'The checklist is already on the current template.' }, 409)),
  http.patch(`${BASE}/documents/:documentId/checklist/reorder`, async ({ request }) => {
    const b = await request.json() as { items: Array<{ itemId: string; sortOrder: number }> }
    return json({ updated: b.items.length, items: b.items.map(i => ({ id: i.itemId, sortOrder: i.sortOrder })) })
  }),
  http.get(`${BASE}/documents/:documentId/checklist/submit-check`, async () => json({ decision: { kind: 'clean' }, totalItems: 0 })),
  http.post(`${BASE}/documents/:documentId/checklist/submit-with-reason`, async ({ params }) => json(docOf(params.documentId))),
  http.post(`${BASE}/documents/:documentId/checklist/autocheck/run`, async () => json({ results: [], completedCount: 0 })),
  http.post(`${BASE}/documents/:documentId/checklist/autocheck/ai-pass/:profile`, async ({ params }) =>
    json({ profile: params.profile, criticalIssues: 0, summary: 'Mock review: no issues.', gateway: { model: 'mock', inputTokens: 0, outputTokens: 0, costUsd: 0, limitDecision: 'allowed' } })),
  http.post(`${BASE}/checklist-templates/:templateId/approve`, async ({ params }) => json({ id: params.templateId, version: 2, inFlightDocumentsNotified: 0 })),
  http.post(`${BASE}/checklist-templates/:templateId/items`, async () => json({ id: `item-${Date.now()}` }, 201)),
  http.patch(`${BASE}/checklist-templates/items/:itemId`, async ({ params }) => json({ id: params.itemId })),
  http.delete(`${BASE}/checklist-templates/items/:itemId`, async () => new HttpResponse(null, { status: 204 })),
  http.post(`${BASE}/checklist-templates/items/:itemId/move`, async () => json({ moved: true })),

  // --- Comments, audit, voice notes, section edits, AI chat
  http.get(`${BASE}/documents/:documentId/comments/mentionable`, async () =>
    json(users.filter(u => u.id !== ME).map(u => ({ id: u.id, name: u.name, initials: initialsOf(u.id), projectRole: null })))),
  http.get(`${BASE}/documents/:documentId/audit`, async () => json({ entries: [], total: 0, limit: 50, offset: 0 })),
  http.get(`${BASE}/documents/:documentId/voice-notes/:noteId/audio`, async () => new HttpResponse(new Uint8Array(0), { headers: { 'Content-Type': 'audio/webm' } })),
  http.post(`${BASE}/documents/:documentId/brief/open-flags/:flagId/resolve`, async () => json({ ok: true })),
  http.get(`${BASE}/documents/section-edits/:editId/diff`, async ({ params }) =>
    json({ editHistoryId: params.editId, documentId: null, sectionId: null, origin: 'human', createdAt: NOW(), beforeHtml: '<p>Before</p>', afterHtml: '<p>After</p>' })),
  http.post(`${BASE}/documents/section-edits/:editId/revert`, async () =>
    json({ ok: true, documentId: documents[0]!.id, sectionId: 's1', contentHtml: '<p>Before</p>', revertedAt: NOW() })),
  http.post(`${BASE}/documents/ai-chat-messages/:messageId/accept`, async ({ params }) =>
    json({ id: params.messageId, appliedToSection: true, appliedAt: NOW(), aiCallRecordId: null })),

  // --- CRM
  http.get(`${BASE}/documents/:documentId/crm/people`, async () => {
    const body: CrmPerson[] = users.map(u => ({ id: u.id, name: u.name, initials: initialsOf(u.id), letters: ['C'], isPm: u.role === 'pm', canChair: u.role !== 'auditor' }))
    return json(body)
  }),
  http.get(`${BASE}/documents/:documentId/crm/access`, async () => json({ canSchedule: true })),
  http.post(`${BASE}/crm/:meetingId/transcript`, async ({ params, request }) => {
    const b = await request.json() as { rawText: string; source?: string }
    return json({ transcript: { id: `tr-${Date.now()}`, meetingId: String(params.meetingId), wordCount: b.rawText.split(/\s+/).filter(Boolean).length, source: b.source ?? 'manual_paste', uploadedBy: ME, uploadedAt: NOW() }, drafts: 0, aiModel: 'mock' }, 201)
  }),
  http.get(`${BASE}/crm/:meetingId/ai-drafts`, async ({ params }) => json({ meetingId: params.meetingId, drafts: [], transcript: null })),
  http.post(`${BASE}/crm/:meetingId/minutes`, async ({ params }) => json({ meetingId: params.meetingId, minutesHtml: '<p>Minutes (mock).</p>', generatedAt: NOW() })),

  // --- Signatures
  http.get(`${BASE}/signature-chains/:chainId`, async ({ params }) =>
    json({ id: params.chainId, documentId: documents[0]!.id, chainType: 'sequential', status: 'in_progress', initiatedBy: ME, initiatedAt: NOW(), completedAt: null, cancelledAt: null, cancelReason: null, records: [] })),

  // --- Document RACI
  http.get(`${BASE}/documents/:documentId/raci`, async ({ params }) => json(raciRows(String(params.documentId)).filter(r => !r.removedAt))),
  http.get(`${BASE}/documents/:documentId/raci/can-edit`, async () => json({ canEdit: !chainActive(), chainActive: chainActive() })),
  http.get(`${BASE}/documents/:documentId/pending`, async ({ params }) => {
    const rows = raciRows(String(params.documentId))
    const pending: PendingPerson[] = rows.filter(r => !r.removedAt && (r.letter === 'C' || r.letter === 'Q') && !r.reviewedAt).map(r => ({ userId: r.userId, name: nameOf(r.userId), letter: r.letter, remindedAt: null }))
    return json({ gatingLetters: ['C', 'Q'], pending })
  }),
  http.post(`${BASE}/documents/:documentId/raci`, async ({ params, request }) => {
    if (chainActive()) return json({ error: 'signature_chain_active', message: "A signature chain is in progress for this document, so its RACI can't be changed. Cancel the chain first." }, 409)
    const b = await request.json() as Partial<DocumentRaciRow> & { userId: string; letter: RaciLetter }
    const rows = raciRows(String(params.documentId))
    const row: DocumentRaciRow = {
      id: `raci-${raciSeq++}`, documentId: String(params.documentId), userId: b.userId, letter: b.letter, sectionId: b.sectionId ?? null,
      approvalOrder: b.approvalOrder ?? null, signatureRequired: b.signatureRequired ?? false, signatureMeaning: b.signatureMeaning ?? null,
      submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null,
      assignedBy: ME, assignedAt: NOW(), removedAt: null, userName: nameOf(b.userId),
    }
    rows.push(row)
    return json(row, 201)
  }),
  http.delete(`${BASE}/documents/:documentId/raci/:raciId`, async ({ params }) => {
    const row = raciRows(String(params.documentId)).find(r => r.id === params.raciId)
    if (!row) return json({ error: 'not_found' }, 404)
    row.removedAt = NOW()
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(`${BASE}/documents/:documentId/raci/:raciId/complete`, async ({ params }) => {
    const rows = raciRows(String(params.documentId))
    const row = rows.find(r => r.id === params.raciId)
    if (!row) return json({ error: 'not_found' }, 404)
    if (row.letter === 'R') return json({ error: 'use_submit_for_review', message: 'Authors (R) submit their part with Submit for review.' }, 409)
    if (row.letter === 'C') {
      const ahead = reviewersAhead(rows, row.userId)
      if (ahead.length > 0) return json({ error: 'review_not_your_turn', message: `Reviews are in order. ${ahead.map(nameOf).join(', ')} must finish first.`, waitingFor: ahead.map(id => ({ userId: id, name: nameOf(id) })) }, 409)
    }
    const now = NOW()
    if (row.letter === 'C' || row.letter === 'Q') row.reviewedAt = now
    if (row.letter === 'A') row.approvedAt = now
    const cohort = cohortFor(rows, row.letter === 'A' ? 'A' : 'C').concat(row.letter === 'A' ? [] : cohortFor(rows, 'Q'))
    const done = cohort.filter(r => r.reviewedAt || r.approvedAt).length
    return json({ row, transition: { gatingLetter: row.letter, nextStatus: null, cohortDone: done, cohortTotal: cohort.length, cohortComplete: done === cohort.length, rejectedRows: 0 }, transitioned: false })
  }),
  http.post(`${BASE}/documents/:documentId/raci/:raciId/reject`, async ({ params, request }) => {
    const row = raciRows(String(params.documentId)).find(r => r.id === params.raciId)
    if (!row) return json({ error: 'not_found' }, 404)
    const b = await request.json() as { note: string }
    row.rejectionNote = b.note
    return json({ row, document: { id: String(params.documentId), status: 'in_authoring' }, version: { id: `ver-${Date.now()}`, versionNumber: 'v0.6' } })
  }),

  // --- Assignable users, members, dashboards
  http.get(`${BASE}/projects/:projectId/assignable-users`, async ({ request }) => {
    const scope = new URL(request.url).searchParams.get('scope')
    if (scope === 'people') return json(users.map(u => ({ id: u.id, name: u.name, initials: initialsOf(u.id), status: u.status })))
    const body: AssignableUser[] = users.filter(u => u.role !== 'admin').map(u => ({
      id: u.id, name: u.name, email: u.email, initials: initialsOf(u.id), capabilities: ['can-author', 'can-review', 'can-approve', 'can-qc'], projectRole: null,
    }))
    return json(body)
  }),
  http.get(`${BASE}/projects/:projectId/members`, async ({ params }) => json(members.filter(m => m.projectId === params.projectId && !m.removedAt))),
  http.post(`${BASE}/projects/:projectId/members`, async ({ params, request }) => {
    const b = await request.json() as { userId: string; projectRole?: string | null }
    const m: ProjectMember = { id: `pm-${Date.now()}`, projectId: String(params.projectId), userId: b.userId, projectRole: b.projectRole ?? null, addedBy: ME, addedAt: NOW(), removedAt: null }
    members.push(m)
    return json(m, 201)
  }),
  http.delete(`${BASE}/projects/:projectId/members/:memberId`, async ({ params }) => {
    const m = members.find(x => x.id === params.memberId)
    if (m) m.removedAt = NOW()
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${BASE}/projects/:projectId/pm-dashboard`, async ({ params }) => {
    const docs = documents.filter(d => d.projectId === params.projectId)
    const byStatus: Record<string, number> = {}
    for (const d of docs) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1
    return json({
      project: { id: String(params.projectId), name: String(params.projectId), status: projectStatus.get(String(params.projectId)) ?? 'ongoing' },
      members: [], documents: [], summary: { totalDocuments: docs.length, byStatus, overdueCount: 0, activeMembers: 0 }, bottlenecks: [], generatedAt: NOW(),
    })
  }),
  http.get(`${BASE}/dashboards/portfolio`, async () => json({ projects: [], totals: { projects: 0, documents: documents.length, overdueDocuments: 0, members: 0 }, generatedAt: NOW() })),

  // --- Project managers, people, status, TLF, team
  http.get(`${BASE}/projects/:projectId/managers`, async () => json(MANAGERS)),
  http.post(`${BASE}/projects/:projectId/managers`, async ({ request }) => {
    const b = await request.json() as { userId: string }
    if (!MANAGERS.some(m => m.id === b.userId)) MANAGERS.push({ id: b.userId, name: nameOf(b.userId), email: person(b.userId)?.email ?? '', status: 'active', addedBy: ME, addedAt: NOW(), isCreator: false })
    return json({ managers: MANAGERS, emailQueued: null })
  }),
  http.post(`${BASE}/projects/:projectId/managers/invite`, async ({ request }) => {
    const b = await request.json() as { email: string }
    MANAGERS.push({ id: `invited-${Date.now()}`, name: b.email, email: b.email, status: 'invited', addedBy: ME, addedAt: NOW(), isCreator: false })
    return json({ managers: MANAGERS, emailQueued: false })
  }),
  http.post(`${BASE}/projects/:projectId/managers/:userId/resend`, async () => json({ emailQueued: false })),
  http.delete(`${BASE}/projects/:projectId/managers/:userId`, async ({ params }) => {
    const i = MANAGERS.findIndex(m => m.id === params.userId && !m.isCreator)
    if (i >= 0) MANAGERS.splice(i, 1)
    return json({ managers: MANAGERS })
  }),
  http.get(`${BASE}/projects/:projectId/people`, async () => json({ count: users.length, userIds: users.map(u => u.id) })),
  http.get(`${BASE}/projects/:projectId/status`, async ({ params }) => {
    const status = projectStatus.get(String(params.projectId)) ?? 'ongoing'
    return json({ status, next: NEXT[status] ?? [], history: [] })
  }),
  http.post(`${BASE}/projects/:projectId/transition`, async ({ params, request }) => {
    const b = await request.json() as { to: string; reason: string }
    const from = projectStatus.get(String(params.projectId)) ?? 'ongoing'
    if (!(NEXT[from] ?? []).includes(b.to)) return json({ error: 'invalid_transition', message: `A ${from} project can't move to ${b.to}.` }, 409)
    projectStatus.set(String(params.projectId), b.to)
    return json({ id: params.projectId, status: b.to })
  }),
  http.get(`${BASE}/projects/:projectId/tlf-packages`, async () => json([])),
  http.post(`${BASE}/projects/:projectId/team`, async ({ request }) => json(await request.json(), 201)),
  http.patch(`${BASE}/projects/:projectId/team/:userId`, async ({ request }) => json(await request.json())),
  http.delete(`${BASE}/projects/:projectId/team/:userId`, async () => new HttpResponse(null, { status: 204 })),

  // --- Master Library tabs + the bell (the screens around Clinical Writing)
  http.get(`${BASE}/notifications/me/unread-count`, async () => json({ count: 0 })),
  http.get(`${BASE}/checklist-templates`, async () => json([])),
  http.get(`${BASE}/document-templates`, async () => json([])),
  http.get(`${BASE}/document-type-policies`, async () => json({ policies: [] })),
  http.get(`${BASE}/admin/frameworks`, async () => json([])),

  // --- Guests
  http.get(`${BASE}/documents/:documentId/guest-invitations`, async () => json([])),
  http.get(`${BASE}/projects/:projectId/guest-invitations`, async () => json([])),
  http.post(`${BASE}/documents/:documentId/guest-invitations`, async ({ request }) => {
    if (chainActive()) return json({ error: 'signature_chain_active', message: "A signature chain is in progress for this document, so new guests can't be invited. Cancel the chain first, or invite after it is signed." }, 409)
    const b = await request.json() as { email: string; purpose: string }
    return json({ id: `inv-${Date.now()}`, scope: 'document', email: b.email, purpose: b.purpose, token: 'MOCK.GUEST.TOKEN', tokenPreview: 'MOCK.GUEST.TOK…', expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }, 201)
  }),
  http.post(`${BASE}/projects/:projectId/guest-invitations`, async ({ request }) => {
    const b = await request.json() as { email: string; purpose: string }
    return json({ id: `inv-${Date.now()}`, scope: 'project', email: b.email, purpose: b.purpose, token: 'MOCK.GUEST.TOKEN', tokenPreview: 'MOCK.GUEST.TOK…', expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }, 201)
  }),
  http.delete(`${BASE}/guest-invitations/:id`, async () => json({ ok: true })),
  http.get(`${BASE}/guest/verify/:token`, async () => json({ scope: 'document', documentId: documents[0]!.id, projectId: documents[0]!.projectId, email: 'guest@example.com', purpose: 'kol-review' })),
  http.get(`${BASE}/guest/document/:token`, async () => { await delay(100); return json({ document: { id: documents[0]!.id, title: documents[0]!.title, sections: [] }, comments: [] }) }),
  http.post(`${BASE}/guest/document/:token/comments`, async ({ request }) => {
    const b = await request.json() as { sectionRef: string; text: string }
    return json({ id: `c-${Date.now()}`, sectionRef: b.sectionRef, text: b.text, status: 'open', createdAt: NOW() }, 201)
  }),
]
