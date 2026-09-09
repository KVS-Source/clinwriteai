import { http, HttpResponse, delay } from 'msw'
import medContent           from '../../data/medContent.json'
import medClaims            from '../../data/medClaims.json'
import medPreMLR            from '../../data/medPreMLR.json'
import medAgenticReport     from '../../data/medAgenticReport.json'
import medMLRReviewers      from '../../data/medMLRReviewers.json'
import medMLRComments       from '../../data/medMLRComments.json'
import medKOLSession        from '../../data/medKOLSession.json'
import medLibraryCards      from '../../data/medLibraryCards.json'
import contentExpiryRecords from '../../data/contentExpiryRecords.json'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

// Simple in-memory copy of KOL session state — mutated by upload/generate
let kolSessionState = medKOLSession as { id: string; contentItemId: string; sessionDate: string; attendees: unknown[]; transcriptUploadedAt?: string | null; insightsReportGeneratedAt?: string | null }

// Default WCAG failures set — returned by /wcag/run
const WCAG_FAILURES = [
  { id: 'wcag-001', criterion: '1.1.1 Non-text content',       severity: 'must-fix',  slide: 'Slide 3',  detail: 'Image on Slide 3 has no alt text.',                       fixed: false },
  { id: 'wcag-002', criterion: '1.4.3 Contrast (Minimum)',     severity: 'should-fix', slide: 'Slide 7',  detail: 'Text–background contrast ratio 3.8:1 (needs 4.5:1).',    fixed: false },
  { id: 'wcag-003', criterion: '2.4.6 Headings and Labels',    severity: 'should-fix', slide: 'Slide 12', detail: 'Heading order skips H2 → H4.',                          fixed: false },
  { id: 'wcag-004', criterion: '3.1.5 Reading Level',          severity: 'note',       slide: 'Slide 18', detail: 'Paragraph FK 11.4 — above patient-facing 8.0 target.',  fixed: false },
]

const LOCALES = [
  { code: 'en-GB', label: 'English (UK)',      enabled: true,  status: 'approved' },
  { code: 'de-DE', label: 'German',            enabled: true,  status: 'in-review' },
  { code: 'fr-FR', label: 'French',            enabled: true,  status: 'translating' },
  { code: 'es-ES', label: 'Spanish',           enabled: false, status: 'not-started' },
  { code: 'it-IT', label: 'Italian',           enabled: false, status: 'not-started' },
]

export const medContentHandlers = [
  // --- Content list + CRUD ---
  http.get(`${BASE}/projects/:projectId/med-content`, async () => {
    await delay(150)
    // Module C home is a cross-project view rooted at the current project context.
    return HttpResponse.json(medContent)
  }),
  http.get(`${BASE}/med-content/:contentId`, async ({ params }) => {
    await delay(120)
    const item = medContent.find(m => m.id === params.contentId)
    return item ? HttpResponse.json(item) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/projects/:projectId/med-content`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    return HttpResponse.json({
      id:              `mc-${Date.now().toString(36)}`,
      projectId:       params.projectId,
      status:          'briefing',
      stage:           1,
      version:         'v0.1',
      aiFootprintPct:  0,
      fkScore:         null,
      fkPassed:        null,
      expiryDate:      null,
      approvedAt:      null,
      ...body,
    }, { status: 201 })
  }),
  http.patch(`${BASE}/med-content/:contentId`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(200)
    const item = medContent.find(m => m.id === params.contentId)
    return HttpResponse.json({ ...item, ...body })
  }),
  http.patch(`${BASE}/med-content/:contentId/tier`, async ({ request }) => {
    const body = await request.json() as { newTier: number; reason: string; overriddenBy: string }
    await delay(220)
    return HttpResponse.json({
      reviewTier:             body.newTier,
      reviewTierOverriddenBy: body.overriddenBy,
      overrideReason:         body.reason,
      overriddenAt:           new Date().toISOString(),
    })
  }),

  // --- FK score ---
  http.get(`${BASE}/med-content/:contentId/fk-score`, async ({ params }) => {
    await delay(200)
    const item = medContent.find(m => m.id === params.contentId)
    return HttpResponse.json({
      score:  item?.fkScore ?? 9.2,
      passed: item?.fkPassed ?? false,
      runAt:  new Date().toISOString(),
    })
  }),

  // --- AI suggest ---
  http.post(`${BASE}/med-content/:contentId/ai-suggest`, async () => {
    await delay(1200)
    return HttpResponse.json({
      responseText: 'We thank the reviewer for this observation. The revised passage has been updated to include the supporting citation and the corresponding safety qualifier.',
      aiModel:      'claude-sonnet-4-6',
      generatedAt:  new Date().toISOString(),
    })
  }),

  // --- Pre-MLR ---
  http.post(`${BASE}/med-content/:contentId/pre-mlr/run`, async ({ params }) => {
    await delay(1600)
    const result = medPreMLR.contentItemId === params.contentId ? medPreMLR : { ...medPreMLR, contentItemId: params.contentId as string }
    return HttpResponse.json({ runAt: new Date().toISOString(), result })
  }),
  http.get(`${BASE}/med-content/:contentId/pre-mlr`, async () => {
    await delay(100)
    return HttpResponse.json(medPreMLR)
  }),
  http.patch(`${BASE}/med-content/:contentId/pre-mlr/issues/:issueId/acknowledge`, async ({ request }) => {
    const body = await request.json() as { acknowledgedBy: string }
    await delay(120)
    return HttpResponse.json({ acknowledgedAt: new Date().toISOString(), acknowledgedBy: body.acknowledgedBy })
  }),

  // --- Agentic report ---
  http.get(`${BASE}/med-content/:contentId/agentic-report`, async () => {
    await delay(120)
    return HttpResponse.json(medAgenticReport)
  }),
  http.post(`${BASE}/med-content/:contentId/agentic-report/findings/:n/escalate`, async ({ request }) => {
    const body = await request.json() as { escalatedBy: string }
    await delay(180)
    return HttpResponse.json({
      escalationAuditId: `ae-esc-${Date.now().toString(36)}`,
      escalatedAt:       new Date().toISOString(),
      escalatedBy:       body.escalatedBy,
    })
  }),

  // --- Submit to MLR ---
  http.post(`${BASE}/med-content/:contentId/submit-to-mlr`, async () => {
    await delay(300)
    return HttpResponse.json({
      submittedAt:  new Date().toISOString(),
      auditEntryId: `ae-submit-${Date.now().toString(36)}`,
    })
  }),

  // --- MLR reviewers + comments + decision ---
  http.get(`${BASE}/med-content/:contentId/mlr-reviewers`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(medMLRReviewers.filter(r => r.contentItemId === params.contentId))
  }),
  http.get(`${BASE}/med-content/:contentId/mlr-comments`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(medMLRComments.filter(c => c.contentItemId === params.contentId))
  }),
  http.post(`${BASE}/med-content/:contentId/mlr-comments`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(200)
    return HttpResponse.json({
      id:                     `MLR-C-${Date.now().toString(36).slice(-3).toUpperCase()}`,
      createdAt:              new Date().toISOString(),
      resolvedAt:             null,
      resolvedBy:             null,
      escalatedFromAgentic:   false,
      ...body,
    }, { status: 201 })
  }),
  http.patch(`${BASE}/med-content/:contentId/mlr-comments/:commentId/resolve`, async ({ request }) => {
    const body = await request.json() as { resolvedBy: string }
    await delay(150)
    return HttpResponse.json({ resolvedAt: new Date().toISOString(), resolvedBy: body.resolvedBy })
  }),
  http.post(`${BASE}/med-content/:contentId/mlr-decision`, async ({ request }) => {
    const body = await request.json() as { decision: string }
    await delay(500)
    const nextStatus = body.decision === 'approve' || body.decision === 'approve-with-revisions'
      ? 'mlr-approved'
      : body.decision === 'return-to-author'
        ? 'in-authoring'
        : 'expired'
    return HttpResponse.json({
      decisionAt:   new Date().toISOString(),
      auditEntryId: `ae-mlr-${Date.now().toString(36)}`,
      nextStatus,
    })
  }),

  // --- Claims ---
  http.get(`${BASE}/med-content/:contentId/claims`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(medClaims.filter(c => c.contentItemId === params.contentId))
  }),
  http.post(`${BASE}/med-content/:contentId/claims/harvest`, async () => {
    await delay(1400)
    return HttpResponse.json({
      candidates: medClaims.slice(0, 3).map(c => ({ ...c, approvalStatus: 'new' as const, similarityPct: 0 })),
    })
  }),
  http.post(`${BASE}/med-content/:contentId/claims/adopt`, async ({ request }) => {
    const body = await request.json() as { claimId: string; approvedLibraryText: string; adoptedBy: string }
    await delay(200)
    return HttpResponse.json({
      claimId:             body.claimId,
      approvedLibraryText: body.approvedLibraryText,
      adoptedAt:           new Date().toISOString(),
      adoptedBy:           body.adoptedBy,
    })
  }),
  http.patch(`${BASE}/med-content/:contentId/claims/:claimId`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(160)
    return HttpResponse.json({ ...body, updatedAt: new Date().toISOString() })
  }),

  // --- KOL session ---
  http.get(`${BASE}/med-content/:contentId/kol-session`, async ({ params }) => {
    await delay(150)
    const session = kolSessionState.contentItemId === params.contentId ? kolSessionState : { ...kolSessionState, contentItemId: params.contentId as string }
    return HttpResponse.json(session)
  }),
  http.post(`${BASE}/kol-sessions/:sessionId/transcript`, async ({ request }) => {
    const body = await request.json() as { transcriptText: string; uploadedBy: string }
    await delay(300)
    kolSessionState = { ...kolSessionState, transcriptUploadedAt: new Date().toISOString() }
    return HttpResponse.json({ uploadedAt: new Date().toISOString(), uploadedBy: body.uploadedBy, textLength: body.transcriptText.length })
  }),
  http.post(`${BASE}/kol-sessions/:sessionId/insights/generate`, async () => {
    await delay(2000)
    kolSessionState = { ...kolSessionState, insightsReportGeneratedAt: new Date().toISOString() }
    return HttpResponse.json({
      insightsReportText: 'Advisory board consensus:\n\n1. Veloricept + pembrolizumab is a compelling first-line option for PD-L1 ≥50% patients — the PFS separation is clinically meaningful.\n2. Safety profile is manageable; grade ≥3 AE rates are consistent with expectations for combination immunotherapy.\n3. Investigators recommend positioning the combination as a preferred option in current NCCN guidelines pending FDA action.',
      generatedAt:        new Date().toISOString(),
    })
  }),

  // --- Formatting / WCAG / Locales ---
  http.post(`${BASE}/med-content/:contentId/wcag/run`, async () => {
    await delay(1400)
    return HttpResponse.json({
      runAt:    new Date().toISOString(),
      passed:   false,
      score:    82,
      failures: WCAG_FAILURES,
    })
  }),
  http.patch(`${BASE}/med-content/:contentId/wcag/failures/:failureId/fix`, async ({ request }) => {
    const body = await request.json() as { fixedBy: string }
    await delay(180)
    return HttpResponse.json({ fixedAt: new Date().toISOString(), fixedBy: body.fixedBy })
  }),
  http.get(`${BASE}/med-content/:contentId/locales`, async () => {
    await delay(100)
    return HttpResponse.json(LOCALES)
  }),

  // --- Final output + library push ---
  http.get(`${BASE}/med-content/:contentId/final`, async ({ params }) => {
    await delay(150)
    const contentItem = medContent.find(m => m.id === params.contentId) ?? medContent[0]
    const cards       = medLibraryCards.filter(c => c.contentItemId === params.contentId)
    const expiry      = contentExpiryRecords.find(e => e.contentItemId === params.contentId) ?? contentExpiryRecords[0]
    return HttpResponse.json({
      contentItem,
      libraryCards: cards,
      expiryRecord: expiry,
      approvals: [
        { name: 'Dr Rebecca Morton', role: 'MLR Medical Reviewer', decidedAt: '2026-10-15T10:45:00Z' },
        { name: 'Mr David Chen',     role: 'MLR Legal Reviewer',    decidedAt: '2026-10-14T16:45:00Z' },
        { name: 'Ms Sarah Chen',     role: 'MLR Lead',               decidedAt: '2026-10-17T09:20:00Z' },
      ],
    })
  }),
  http.post(`${BASE}/med-content/:contentId/library/push`, async ({ request }) => {
    const body = await request.json() as { cardIds: string[]; pushedBy: string }
    await delay(300)
    return HttpResponse.json({
      pushedAt:  new Date().toISOString(),
      cardCount: body.cardIds.length,
      pushedBy:  body.pushedBy,
    })
  }),

  // --- Portfolio ---
  http.get(`${BASE}/projects/:projectId/med-content/portfolio`, async ({ request }) => {
    await delay(150)
    const scope = new URL(request.url).searchParams.get('scope')
    // Portfolio is a cross-project view rooted at the current project context.
    if (!scope || scope === 'all' || scope === 'All projects') return HttpResponse.json(medContent)
    // Scope can be a projectId (e.g. proj-velora-301) OR a status token
    const byProject = medContent.filter(m => m.projectId === scope)
    if (byProject.length > 0) return HttpResponse.json(byProject)
    return HttpResponse.json(medContent.filter(m => m.status === scope))
  }),
]
