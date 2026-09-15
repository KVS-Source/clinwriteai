// Platform & Admin Module (sPM04–sPM18) + Module B Slide Deck (sB10) — MSW handlers.
// Registered in browser.ts as ...platformHandlers.
import { http, HttpResponse, delay } from 'msw'
import platformConfig  from '../../data/platformConfig.json'
import users           from '../../data/users.json'
import raciMatrix      from '../../data/raciMatrix.json'
import masterLibrary   from '../../data/masterLibraryItems.json'
import bestPractices   from '../../data/bestPractices.json'
import notifications   from '../../data/notifications.json'
import notifPrefs      from '../../data/notificationPrefs.json'
import auditTrail      from '../../data/auditTrail.json'
import ratecards       from '../../data/ratecards.json'
import subscription    from '../../data/subscription.json'
import reports         from '../../data/reports.json'
import healthScores    from '../../data/moduleHealthScores.json'
import taTags          from '../../data/taTags.json'
import regFrameworks   from '../../data/regulatoryFrameworks.json'
import slidedeckJob    from '../../data/slidedeckJob.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// In-memory state so mutations (mark-read, invites, gate acknowledgements, etc.)
// persist for the duration of a session.
let usersState         = users            as Array<Record<string, unknown>>
let notificationsState = notifications    as Array<Record<string, unknown>>
let notifPrefsState    = notifPrefs       as Array<Record<string, unknown>>
let ratecardsState     = ratecards        as Array<Record<string, unknown>>
let taTagsState        = taTags           as Array<Record<string, unknown>>
let regFrameworksState = regFrameworks    as Array<Record<string, unknown>>
const auditTrailState  = auditTrail       as Array<Record<string, unknown>>
let slidedeckJobState  = slidedeckJob     as Record<string, unknown>

export const platformHandlers = [
  // --- sPM04 / sPM05 Admin + Super Admin config ---
  http.get(`${BASE}/admin/config`, async () => {
    await delay(100)
    return HttpResponse.json(platformConfig)
  }),

  // --- sPM06 User Management ---
  http.get(`${BASE}/admin/users`, async () => {
    await delay(120)
    return HttpResponse.json(usersState)
  }),
  http.post(`${BASE}/admin/users/invite`, async ({ request }) => {
    await delay(200)
    const body = await request.json() as Record<string, unknown>
    const invited = {
      id:         `user-inv-${Date.now()}`,
      name:       body.name ?? 'New User',
      email:      body.email ?? '',
      role:       body.role ?? 'author',
      modules:    body.modules ?? [],
      status:     'invited',
      lastActive: null,
    }
    usersState = [...usersState, invited as Record<string, unknown>]
    return HttpResponse.json(invited, { status: 201 })
  }),
  http.patch(`${BASE}/admin/users/:userId`, async ({ params, request }) => {
    await delay(120)
    const patch = await request.json() as Record<string, unknown>
    usersState = usersState.map(u => u.id === params.userId ? { ...u, ...patch } : u)
    return HttpResponse.json(usersState.find(u => u.id === params.userId))
  }),

  // --- sPM07 RACI Matrix ---
  http.get(`${BASE}/raci/:projectId`, async () => {
    await delay(100)
    return HttpResponse.json(raciMatrix)
  }),

  // --- sPM08 Master Library ---
  http.get(`${BASE}/library`, async () => {
    await delay(150)
    return HttpResponse.json(masterLibrary)
  }),

  // --- sPM09 Best Practices ---
  // Static routes MUST be registered before `${BASE}/library/:itemId` so MSW
  // does not swallow /library/best-practices as an itemId=best-practices lookup.
  http.get(`${BASE}/library/best-practices`, async () => {
    await delay(120)
    return HttpResponse.json(bestPractices)
  }),
  http.post(`${BASE}/library/best-practices`, async ({ request }) => {
    await delay(200)
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...body, id: `bp-${Date.now()}`, publishedAt: new Date().toISOString() }, { status: 201 })
  }),

  // sPM08 Master Library — item-by-id (parameterised, registered last of the /library/* GETs)
  http.get(`${BASE}/library/:itemId`, async ({ params }) => {
    await delay(120)
    const item = (masterLibrary as Array<Record<string, unknown>>).find(x => x.id === params.itemId)
    return item
      ? HttpResponse.json(item)
      : HttpResponse.json({ error: 'not-found' }, { status: 404 })
  }),

  // --- sPM14 Notifications ---
  http.get(`${BASE}/notifications`, async () => {
    await delay(120)
    return HttpResponse.json(notificationsState)
  }),
  http.get(`${BASE}/notifications/preferences`, async () => {
    await delay(100)
    return HttpResponse.json(notifPrefsState)
  }),
  http.patch(`${BASE}/notifications/preferences`, async ({ request }) => {
    await delay(150)
    const patch = await request.json() as Array<Record<string, unknown>>
    notifPrefsState = patch
    return HttpResponse.json(notifPrefsState)
  }),
  http.patch(`${BASE}/notifications/:id/mark-read`, async ({ params }) => {
    await delay(80)
    notificationsState = notificationsState.map(n =>
      n.id === params.id ? { ...n, isRead: true } : n,
    )
    return HttpResponse.json(notificationsState.find(n => n.id === params.id))
  }),

  // --- sPM15 Audit Trail ---
  http.get(`${BASE}/audit`, async () => {
    await delay(150)
    return HttpResponse.json(auditTrailState)
  }),
  http.get(`${BASE}/audit/:id`, async ({ params }) => {
    await delay(100)
    const entry = auditTrailState.find(a => a.id === params.id)
    return entry
      ? HttpResponse.json(entry)
      : HttpResponse.json({ error: 'not-found' }, { status: 404 })
  }),
  // Immutability — no PATCH / DELETE allowed. Any attempt logs an audit event.
  http.patch(`${BASE}/audit/:id`, async () => {
    await delay(30)
    return HttpResponse.json({ error: 'immutable', message: 'Audit records are immutable. This attempt has been logged.' }, { status: 403 })
  }),
  http.delete(`${BASE}/audit/:id`, async () => {
    await delay(30)
    return HttpResponse.json({ error: 'immutable', message: 'Audit records are immutable. This attempt has been logged.' }, { status: 403 })
  }),
  http.get(`${BASE}/audit/export/csv`, async () => {
    await delay(200)
    return HttpResponse.json({ downloadUrl: `/downloads/audit-${Date.now()}.csv`, rowCount: auditTrailState.length })
  }),

  // --- sPM05 Super Admin — clients + analytics ---
  http.get(`${BASE}/super-admin/clients`, async () => {
    await delay(150)
    return HttpResponse.json([
      { id: 'client-genbioca-001', name: 'GenBioCa Sciences',   note: '(internal)', plan: 'Enterprise',   status: 'active',    adminContactName: 'Dr James Hartley', createdAt: '2026-01-01', revenueToDateGBP: 0     },
      { id: 'client-medpharma',    name: 'MedPharma Ltd',       plan: 'Professional', status: 'active',    adminContactName: 'Sarah Okonkwo',    createdAt: '2026-03-15', revenueToDateGBP: 24800 },
      { id: 'client-globalclin',   name: 'GlobalClinicals Inc', plan: 'Starter',      status: 'active',    adminContactName: 'Mark Reeves',      createdAt: '2026-06-01', revenueToDateGBP: 6200  },
      { id: 'client-biothera',     name: 'BioTherapeutics AG',  plan: 'Enterprise',   status: 'suspended', adminContactName: 'Hans Müller',      createdAt: '2026-02-12', revenueToDateGBP: 41000 },
      { id: 'client-datarx',       name: 'DataRx Corp',         plan: 'Professional', status: 'churned',   adminContactName: null,               createdAt: '2026-04-10', revenueToDateGBP: 8400  },
    ])
  }),
  http.get(`${BASE}/super-admin/analytics`, async () => {
    await delay(120)
    return HttpResponse.json({
      totalActiveUsers:          247,
      activeProjects:            34,
      documentsCreatedRolling30: 1847,
      aiTokensRolling30:         4_200_000,
      mrrGBP:                    18400,
      arrGBP:                    220800,
      churnThisQuarter:          1,
      avgTokensPerClientMonth:   600000,
      clientCounts: { active: 7, suspended: 1, churned: 1 },
    })
  }),

  // --- sPM12 Rate Cards (Super Admin) ---
  http.get(`${BASE}/super-admin/rate-cards`, async () => {
    await delay(150)
    return HttpResponse.json(ratecardsState)
  }),
  http.post(`${BASE}/super-admin/rate-cards`, async ({ request }) => {
    await delay(250)
    const body = await request.json() as Record<string, unknown>
    // Enforce "cannot be backdated" — reject effectiveFrom in the past.
    const effectiveFrom = String(body.effectiveFrom ?? '')
    if (effectiveFrom && new Date(effectiveFrom) < new Date(new Date().toISOString().slice(0, 10))) {
      return HttpResponse.json(
        { error: 'backdating-not-allowed', message: 'Rate cards cannot be backdated. effectiveFrom must be today or later.' },
        { status: 422 },
      )
    }
    const created = { ...body, id: `ratecard-${Date.now()}`, status: 'active', archivedAt: null }
    ratecardsState = [...ratecardsState, created as Record<string, unknown>]
    return HttpResponse.json(created, { status: 201 })
  }),

  // --- sPM11 Services Dashboard + sPM13 Subscription & Payment ---
  http.get(`${BASE}/services/dashboard`, async () => {
    await delay(150)
    return HttpResponse.json(subscription)
  }),
  http.get(`${BASE}/admin/subscription`, async () => {
    await delay(120)
    return HttpResponse.json(subscription)
  }),

  // --- sPM16 Reports & Analytics ---
  http.get(`${BASE}/reports/available`, async () => {
    await delay(100)
    return HttpResponse.json(reports)
  }),
  http.get(`${BASE}/reports/health-scores`, async () => {
    await delay(120)
    return HttpResponse.json(healthScores)
  }),
  http.post(`${BASE}/reports/:reportType/generate`, async ({ params, request }) => {
    await delay(500)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    return HttpResponse.json({
      reportType:   params.reportType,
      format:       body.format ?? 'pdf',
      generatedAt:  new Date().toISOString(),
      downloadUrl:  `/downloads/report-${params.reportType}-${Date.now()}.${body.format ?? 'pdf'}`,
    })
  }),

  // --- sPM17 TA Tag Configuration ---
  http.get(`${BASE}/admin/taxonomy`, async () => {
    await delay(100)
    return HttpResponse.json(taTagsState)
  }),
  http.post(`${BASE}/admin/taxonomy`, async ({ request }) => {
    await delay(150)
    const body = await request.json() as Record<string, unknown>
    const created = {
      id:            `tag-${String(body.abbreviation ?? Date.now()).toLowerCase()}`,
      name:          body.name,
      abbreviation:  body.abbreviation,
      status:        'active',
      projectCount:  0,
      documentCount: 0,
      createdAt:     new Date().toISOString().slice(0, 10),
      createdBy:     body.createdBy ?? 'user-admin',
    }
    taTagsState = [...taTagsState, created as Record<string, unknown>]
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch(`${BASE}/admin/taxonomy/:tagId`, async ({ params, request }) => {
    await delay(100)
    const patch = await request.json() as Record<string, unknown>
    taTagsState = taTagsState.map(t => t.id === params.tagId ? { ...t, ...patch } : t)
    return HttpResponse.json(taTagsState.find(t => t.id === params.tagId))
  }),
  http.patch(`${BASE}/admin/taxonomy/:tagId/archive`, async ({ params }) => {
    await delay(100)
    taTagsState = taTagsState.map(t => t.id === params.tagId ? { ...t, status: 'archived', archivedAt: new Date().toISOString().slice(0, 10) } : t)
    return HttpResponse.json(taTagsState.find(t => t.id === params.tagId))
  }),
  http.patch(`${BASE}/admin/taxonomy/:tagId/restore`, async ({ params }) => {
    await delay(100)
    taTagsState = taTagsState.map(t => t.id === params.tagId ? { ...t, status: 'active', archivedAt: undefined } : t)
    return HttpResponse.json(taTagsState.find(t => t.id === params.tagId))
  }),
  http.delete(`${BASE}/admin/taxonomy/:tagId`, async ({ params }) => {
    await delay(100)
    const t = taTagsState.find(x => x.id === params.tagId)
    if (t && ((t as { projectCount: number }).projectCount > 0)) {
      return HttpResponse.json({ error: 'in-use', message: 'A tag in use cannot be deleted — archive it instead.' }, { status: 409 })
    }
    taTagsState = taTagsState.filter(x => x.id !== params.tagId)
    return HttpResponse.json({ ok: true })
  }),

  // --- sPM18 Regulatory Framework Registry (Super Admin) ---
  http.get(`${BASE}/regulatory-frameworks`, async () => {
    await delay(120)
    return HttpResponse.json(regFrameworksState)
  }),
  http.patch(`${BASE}/regulatory-frameworks/:frameworkId`, async ({ params, request }) => {
    await delay(200)
    const patch = await request.json() as Record<string, unknown>
    regFrameworksState = regFrameworksState.map(f => f.id === params.frameworkId ? { ...f, ...patch, lastUpdated: new Date().toISOString().slice(0, 10) } : f)
    return HttpResponse.json(regFrameworksState.find(f => f.id === params.frameworkId))
  }),
  http.delete(`${BASE}/regulatory-frameworks/:frameworkId`, async () => {
    await delay(30)
    return HttpResponse.json(
      { error: 'method-not-allowed', message: 'Frameworks are never deleted. Mark superseded instead.' },
      { status: 405 },
    )
  }),

  // --- sB10 Slide Deck Generator (Module B) ---
  http.get(`${BASE}/publications/:pubId/slides/:jobId`, async () => {
    await delay(150)
    return HttpResponse.json(slidedeckJobState)
  }),
  http.patch(`${BASE}/publications/:pubId/slides/:jobId/slides/:slideId`, async ({ params, request }) => {
    await delay(150)
    const patch = await request.json() as Record<string, unknown>
    const slides = (slidedeckJobState.slides as Array<Record<string, unknown>>) ?? []
    slidedeckJobState = {
      ...slidedeckJobState,
      slides: slides.map(s => s.id === params.slideId ? { ...s, ...patch } : s),
    }
    return HttpResponse.json((slidedeckJobState.slides as Array<Record<string, unknown>>).find(s => s.id === params.slideId))
  }),
  http.post(`${BASE}/publications/:pubId/slides/:jobId/export`, async () => {
    await delay(300)
    const gateActive = slidedeckJobState.congressGateActive === true
    if (gateActive) {
      return HttpResponse.json(
        { error: 'congress-gate-active', message: slidedeckJobState.congressGateMessage },
        { status: 422 },
      )
    }
    return HttpResponse.json({
      exportedAt:  new Date().toISOString(),
      downloadUrl: `/downloads/slidedeck-${Date.now()}.pptx`,
    })
  }),
]
