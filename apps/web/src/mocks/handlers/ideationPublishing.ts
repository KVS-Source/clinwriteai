// Module E — Ideation & Publishing MSW handlers (21 endpoints).
// KOL routes (/kol-review/:token/*) are PUBLIC — no auth required (DD-E rule 5).
import { http, HttpResponse, delay } from 'msw'
import ideationProjects   from '../../data/ideationProjects.json'
import ideationArtefacts  from '../../data/ideationArtefacts.json'
import ideationContentCards from '../../data/ideationContentCards.json'
import atomisedContent    from '../../data/atomisedContent.json'
import claimCurrencyCheck from '../../data/claimCurrencyCheck.json'
import ideationCalendar   from '../../data/ideationCalendar.json'
import socialListeningAlerts from '../../data/socialListeningAlerts.json'
import kolContacts        from '../../data/kolContacts.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

// Simple in-memory state so mutations persist across a session
let projectsState   = ideationProjects        as Array<Record<string, unknown>>
let artefactsState  = ideationArtefacts       as Array<Record<string, unknown>>
let cardsState      = ideationContentCards    as Array<Record<string, unknown>>
let adaptationsState = atomisedContent        as Array<Record<string, unknown>>
let claimCurrencyState = claimCurrencyCheck   as Record<string, unknown> & { claimsExtracted: Array<Record<string, unknown>>; results: { current: number; potentiallySuperseded: number; conflicting: number } }
let calendarState   = ideationCalendar        as Array<Record<string, unknown>>
let alertsState     = socialListeningAlerts   as Array<Record<string, unknown>>

const CHANNEL_LABELS: Record<string, string> = {
  linkedin:          'LinkedIn',
  twitter:           'X / Twitter',
  blog:              'Blog Post',
  email:             'Email',
  hcp:               'HCP Summary',
  'medical-affairs': 'Medical Affairs',
  instagram:         'Instagram',
  facebook:          'Facebook',
}

export const ideationPublishingHandlers = [
  // --- Projects ---
  http.get(`${BASE}/projects/:projectId/ideation-projects`, async () => {
    await delay(150)
    return HttpResponse.json(projectsState)
  }),
  http.get(`${BASE}/ideation-projects/:id`, async ({ params }) => {
    await delay(120)
    const p = projectsState.find(x => x.id === params.id)
    return p ? HttpResponse.json(p) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/projects/:projectId/ideation-projects`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    const created = {
      id:              `ip-${Date.now().toString(36)}`,
      projectId:       params.projectId,
      status:          'uploaded',
      stage:           1,
      createdAt:       new Date().toISOString(),
      updatedAt:       new Date().toISOString(),
      contentCardCount: 0,
      approvedCardCount: 0,
      scheduledCount:  0,
      publishedCount:  0,
      maApprovedAt:    null,
      maApprovedBy:    null,
      ...body,
    }
    projectsState = [...projectsState, created]
    return HttpResponse.json(created)
  }),

  // --- Artefacts + source gate + claim currency ---
  http.get(`${BASE}/ideation-artefacts/:id`, async ({ params }) => {
    await delay(120)
    const a = artefactsState.find(x => x.id === params.id)
    return a ? HttpResponse.json(a) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/ideation-artefacts`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    const created = {
      id:                   `ia-${Date.now().toString(36)}`,
      sourceCurrencyStatus: 'current',
      approvalStatusCheck:  body.externalConfirmed ? 'confirmed-external' : 'pending',
      approvalStatusNote:   'Awaiting source gate check',
      claimCurrencyChecked: false,
      ...body,
    }
    artefactsState = [...artefactsState, created]
    return HttpResponse.json(created)
  }),
  http.post(`${BASE}/ideation-artefacts/:id/source-gate`, async ({ params }) => {
    await delay(1500)
    const a = artefactsState.find(x => x.id === params.id)
    return HttpResponse.json({
      ideationArtefactId:   params.id,
      approvalStatusCheck:  (a?.approvalStatusCheck as string) ?? 'passed',
      approvalStatusNote:   (a?.approvalStatusNote as string) ?? 'Source gate check passed.',
      sourceCurrencyStatus: (a?.sourceCurrencyStatus as string) ?? 'current',
    })
  }),
  http.get(`${BASE}/ideation-artefacts/:id/claim-currency`, async () => {
    await delay(120)
    return HttpResponse.json(claimCurrencyState)
  }),
  http.post(`${BASE}/ideation-artefacts/:id/claim-currency`, async () => {
    await delay(3000)
    return HttpResponse.json(claimCurrencyState)
  }),
  http.patch(`${BASE}/ideation-artefacts/:id/claim-currency/:flagId/acknowledge`, async ({ request }) => {
    const body = await request.json() as { acknowledgedBy: string; note: string }
    await delay(200)
    claimCurrencyState = {
      ...claimCurrencyState,
      claimsExtracted: claimCurrencyState.claimsExtracted.map(c => c.id === 'cl-004' ? {
        ...c, acknowledgedBy: body.acknowledgedBy, acknowledgedAt: new Date().toISOString(), acknowledgementNote: body.note,
      } : c),
      acknowledgedBy: body.acknowledgedBy,
      acknowledgedAt: new Date().toISOString(),
    }
    return HttpResponse.json(claimCurrencyState)
  }),

  // --- Content cards + atomisation ---
  http.get(`${BASE}/ideation-projects/:id/cards`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(cardsState.filter(c => c.ideationProjectId === params.id))
  }),
  http.post(`${BASE}/ideation-projects/:id/cards`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    const created = {
      id: `c-${Date.now().toString(36)}`,
      ideationProjectId: params.id,
      claimCurrencyStatus: 'current',
      kolStatus: 'pending',
      kolApprovedAt: null,
      kolApprovedBy: null,
      maStatus: 'pending',
      maApprovedAt: null,
      overallStatus: 'under-review',
      provenanceChain: [],
      ...body,
    }
    cardsState = [...cardsState, created]
    return HttpResponse.json(created)
  }),
  http.post(`${BASE}/ideation-cards/:id/atomise`, async ({ request, params }) => {
    const body = await request.json() as { channel: string; sourcePassage: string; by: string }
    await delay(2000)
    const created = {
      id:                    `ac-${Date.now().toString(36)}`,
      ideationContentCardId: params.id,
      channel:               body.channel,
      channelLabel:          CHANNEL_LABELS[body.channel] ?? body.channel,
      contentText:           `AI-drafted ${body.channel} adaptation of the source passage. Grounded in ${body.sourcePassage.slice(0, 60)}… Logged to audit trail.`,
      aiGenerated:           true,
      aiFootprintHash:       `af-${body.channel}-${params.id}-${Date.now().toString(36)}`,
      brandScreenPassed:     true,
      complianceScreenPassed: true,
      complianceFixes:       [],
      characterCount:        220,
      wordCount:             34,
    }
    adaptationsState = [...adaptationsState, created]
    return HttpResponse.json(created)
  }),
  http.patch(`${BASE}/ideation-adaptations/:id`, async ({ request, params }) => {
    const body = await request.json() as { contentText: string; by: string }
    await delay(160)
    adaptationsState = adaptationsState.map(a => a.id === params.id ? {
      ...a, contentText: body.contentText, characterCount: body.contentText.length, wordCount: body.contentText.trim().split(/\s+/).length,
    } : a)
    return HttpResponse.json(adaptationsState.find(a => a.id === params.id))
  }),
  http.post(`${BASE}/ideation-adaptations/:id/compliance-screen`, async () => {
    await delay(2000)
    return HttpResponse.json({
      brandScreenPassed:      true,
      complianceScreenPassed: true,
      fixes:                  [],
    })
  }),

  // --- KOL review (PUBLIC — no auth check) ---
  http.get(`${BASE}/kol-review/:token`, async ({ params }) => {
    await delay(120)
    const contact = kolContacts.find(k => k.reviewLinkToken === params.token)
    if (!contact) return HttpResponse.json({ error: 'expired-or-invalid' }, { status: 404 })
    const cards = cardsState.filter(c => c.ideationProjectId === contact.ideationProjectId)
    return HttpResponse.json({ contact, cards })
  }),
  http.post(`${BASE}/kol-review/:token/submit`, async ({ request, params }) => {
    const body = await request.json() as { decisions: { cardId: string; decision: string; comment: string | null }[]; signedOffBy: string }
    await delay(400)
    const contact = kolContacts.find(k => k.reviewLinkToken === params.token)
    if (!contact) return HttpResponse.json({ error: 'expired-or-invalid' }, { status: 404 })
    const signedOffAt = new Date().toISOString()
    // Update card kol status locally
    cardsState = cardsState.map(c => {
      const decision = body.decisions.find(d => d.cardId === c.id)
      if (!decision) return c
      return { ...c, kolStatus: decision.decision, kolApprovedAt: signedOffAt, kolApprovedBy: body.signedOffBy }
    })
    return HttpResponse.json({ ok: true, signedOffAt })
  }),

  // --- MA approval + KOL contact ---
  http.get(`${BASE}/ideation-projects/:id/kol-contact`, async ({ params }) => {
    await delay(120)
    const contact = kolContacts.find(k => k.ideationProjectId === params.id)
    return contact ? HttpResponse.json(contact) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/ideation-projects/:id/ma-approval`, async ({ request, params }) => {
    const body = await request.json() as { approvedBy: string; approvedByName: string }
    await delay(300)
    const approvedAt = new Date().toISOString()
    projectsState = projectsState.map(p => p.id === params.id ? {
      ...p, status: 'approved', stage: 4, maApprovedAt: approvedAt, maApprovedBy: body.approvedBy, maApprovedByName: body.approvedByName,
    } : p)
    cardsState = cardsState.map(c => c.ideationProjectId === params.id && c.kolStatus === 'approved' ? {
      ...c, maStatus: 'approved', maApprovedAt: approvedAt, overallStatus: 'approved',
    } : c)
    return HttpResponse.json(projectsState.find(p => p.id === params.id))
  }),

  // --- Calendar + publishing ---
  http.get(`${BASE}/ideation-projects/:id/calendar`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(calendarState.filter(e => e.ideationProjectId === params.id))
  }),
  http.post(`${BASE}/ideation-calendar`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(300)
    const created = {
      id:                   `cal-${Date.now().toString(36)}`,
      status:               'scheduled',
      publishedAt:          null,
      publishedBy:          null,
      utmParams:            null,
      seoMetadata:          {},
      sentimentScore:       null,
      sentimentAlertSent:   false,
      isOverdue:            false,
      ...body,
    }
    calendarState = [...calendarState, created]
    return HttpResponse.json(created)
  }),
  http.post(`${BASE}/ideation-calendar/:id/publish`, async ({ request, params }) => {
    const body = await request.json() as { publishedBy: string; utmParams?: string; seoMetadata?: Record<string, unknown> }
    await delay(300)
    calendarState = calendarState.map(e => e.id === params.id ? {
      ...e, status: 'published', publishedAt: new Date().toISOString(), publishedBy: body.publishedBy,
      utmParams: body.utmParams ?? e.utmParams,
      seoMetadata: body.seoMetadata ?? e.seoMetadata,
      isOverdue: false,
    } : e)
    return HttpResponse.json(calendarState.find(e => e.id === params.id))
  }),

  // --- Social listening ---
  http.get(`${BASE}/ideation-projects/:id/social-alerts`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(alertsState.filter(a => a.ideationProjectId === params.id))
  }),
  http.patch(`${BASE}/ideation-social-alerts/:id/resolve`, async ({ request, params }) => {
    const body = await request.json() as { resolvedBy: string; note: string }
    await delay(220)
    alertsState = alertsState.map(a => a.id === params.id ? {
      ...a, resolvedAt: new Date().toISOString(), resolvedBy: body.resolvedBy, resolvedByName: body.resolvedBy, resolutionNote: body.note,
    } : a)
    return HttpResponse.json(alertsState.find(a => a.id === params.id))
  }),

  // --- Standards (E10) ---
  http.post(`${BASE}/ideation-cards/:id/doi/register`, async ({ request, params }) => {
    await request.json()
    await delay(500)
    return HttpResponse.json({
      doi:          `10.5555/clinwriteai.${params.id}.${Date.now().toString(36)}`,
      registeredAt: new Date().toISOString(),
    })
  }),
  http.post(`${BASE}/ideation-cards/:id/dublin-core`, async ({ request }) => {
    await request.json()
    await delay(200)
    return HttpResponse.json({ savedAt: new Date().toISOString() })
  }),
  http.post(`${BASE}/ideation-orcid/verify`, async ({ request }) => {
    await request.json()
    await delay(400)
    return HttpResponse.json({ verified: true, verifiedAt: new Date().toISOString() })
  }),
  http.post(`${BASE}/ideation-cards/:id/wcag`, async () => {
    await delay(1200)
    return HttpResponse.json({
      passed:   true,
      score:    98,
      failures: [],
    })
  }),

  // --- Portfolio (E01 cross-project) ---
  http.get(`${BASE}/projects/:projectId/ideation-portfolio`, async ({ request }) => {
    await delay(150)
    const stage = new URL(request.url).searchParams.get('stage')
    if (!stage) return HttpResponse.json(projectsState)
    return HttpResponse.json(projectsState.filter(p => p.status === stage))
  }),
]
