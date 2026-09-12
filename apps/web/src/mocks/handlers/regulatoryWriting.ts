// Module D — Regulatory Writing MSW handlers (32 endpoints).
import { http, HttpResponse, delay } from 'msw'
import regulatorySubmissions   from '../../data/regulatorySubmissions.json'
import ectdGranularityMap      from '../../data/ectdGranularityMap.json'
import cmcReadinessReport      from '../../data/cmcReadinessReport.json'
import consistencyCheckResult  from '../../data/consistencyCheckResult.json'
import ectdValidationResult    from '../../data/ectdValidationResult.json'
import redactionRecord         from '../../data/redactionRecord.json'
import superReviewers          from '../../data/superReviewers.json'
import gatewaySubmissions      from '../../data/gatewaySubmissions.json'
import haCorrespondence        from '../../data/haCorrespondence.json'
import regulatoryAlerts        from '../../data/regulatoryAlerts.json'
import regulatoryLibraryCards  from '../../data/regulatoryLibraryCards.json'
import oddAssessment           from '../../data/oddAssessment.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

// In-memory state so mutations persist within a session
let cmcState                = cmcReadinessReport as { acknowledgedBy: string | null; acknowledgedAt: string | null } & Record<string, unknown>
let consistencyState        = consistencyCheckResult as { passed: boolean; contradictions: { id: string; severity: string; resolved: boolean; resolvedBy: string | null; resolvedAt: string | null; resolutionNote: string | null }[] } & Record<string, unknown>
let validationState         = ectdValidationResult as { errors: { id: string; fixed: boolean }[] } & Record<string, unknown>
let redactionState          = redactionRecord as { documents: { ppdItems: { id: string; confirmed: boolean; confirmedBy: string | null; confirmedAt: string | null }[]; cciItems: { id: string; confirmed: boolean; confirmedBy: string | null; confirmedAt: string | null }[] }[] } & Record<string, unknown>
let gatewayState            = gatewaySubmissions as Array<Record<string, unknown>>
let alertsState             = regulatoryAlerts as Array<Record<string, unknown>>

export const regulatoryWritingHandlers = [
  // --- Submissions ---
  http.get(`${BASE}/projects/:projectId/reg-submissions`, async () => {
    await delay(150)
    return HttpResponse.json(regulatorySubmissions)
  }),
  http.get(`${BASE}/reg-submissions/:submissionId`, async ({ params }) => {
    await delay(120)
    const item = regulatorySubmissions.find(s => s.id === params.submissionId)
    return item ? HttpResponse.json(item) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/projects/:projectId/reg-submissions`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    return HttpResponse.json({
      id:              `sub-${Date.now().toString(36)}`,
      projectId:       params.projectId,
      status:          'source-gathering',
      stage:           1,
      createdAt:       new Date().toISOString(),
      updatedAt:       new Date().toISOString(),
      ...body,
    })
  }),
  http.patch(`${BASE}/reg-submissions/:submissionId`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(160)
    const item = regulatorySubmissions.find(s => s.id === params.submissionId) ?? regulatorySubmissions[0]
    return HttpResponse.json({ ...item, ...body, updatedAt: new Date().toISOString() })
  }),

  // --- Canonical JSON layer + CMC readiness ---
  http.post(`${BASE}/reg-submissions/:submissionId/canonical-json/index`, async ({ params }) => {
    await delay(2000)
    return HttpResponse.json({
      submissionId: params.submissionId,
      indexedAt:    new Date().toISOString(),
      dataPoints:   847,
      sources: [
        { docId: 'DOC-001', docType: 'csr',       extractedPoints: 612 },
        { docId: 'DOC-002', docType: 'ib',        extractedPoints: 148 },
        { docId: 'DOC-003', docType: 'sap',       extractedPoints: 62  },
        { docId: 'DOC-004', docType: 'tlf',       extractedPoints: 25  },
      ],
    })
  }),
  http.get(`${BASE}/reg-submissions/:submissionId/cmc-readiness`, async () => {
    await delay(120)
    return HttpResponse.json(cmcState)
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/cmc-readiness/acknowledge`, async ({ request }) => {
    const body = await request.json() as { acknowledgedBy: string; riskNote?: string }
    await delay(200)
    cmcState = { ...cmcState, acknowledgedBy: body.acknowledgedBy, acknowledgedAt: new Date().toISOString(), riskNote: body.riskNote ?? cmcState.riskNote }
    return HttpResponse.json(cmcState)
  }),

  // --- eCTD map ---
  http.get(`${BASE}/reg-submissions/:submissionId/ectd-map`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json(ectdGranularityMap.filter(n => n.submissionId === params.submissionId))
  }),
  http.patch(`${BASE}/reg-submissions/:submissionId/ectd-map/:nodeId`, async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(180)
    const node = ectdGranularityMap.find(n => n.id === params.nodeId) ?? ectdGranularityMap[0]
    return HttpResponse.json({ ...node, ...body, lastUpdated: new Date().toISOString() })
  }),

  // --- Consistency check (5s per spec) ---
  http.get(`${BASE}/reg-submissions/:submissionId/consistency-check`, async () => {
    await delay(120)
    return HttpResponse.json(consistencyState)
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/consistency-check/run`, async () => {
    await delay(5000)
    return HttpResponse.json({ runAt: new Date().toISOString(), result: consistencyState })
  }),
  http.patch(`${BASE}/reg-submissions/:submissionId/contradictions/:contradictionId/resolve`, async ({ request, params }) => {
    const body = await request.json() as { resolvedBy: string; note: string }
    await delay(220)
    consistencyState = {
      ...consistencyState,
      contradictions: consistencyState.contradictions.map(c => c.id === params.contradictionId ? {
        ...c, resolved: true, resolvedBy: body.resolvedBy, resolvedAt: new Date().toISOString(), resolutionNote: body.note,
      } : c),
    }
    consistencyState.passed = !consistencyState.contradictions.some(c => c.severity === 'major' && !c.resolved)
    return HttpResponse.json(consistencyState)
  }),

  // --- Super Review ---
  http.get(`${BASE}/reg-submissions/:submissionId/super-reviewers`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(superReviewers.filter(r => r.submissionId === params.submissionId))
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/super-reviewers/:reviewerId/sign`, async ({ request, params }) => {
    await request.json()
    await delay(200)
    const r = superReviewers.find(x => x.id === params.reviewerId) ?? superReviewers[0]
    return HttpResponse.json({ ...r, signedAt: new Date().toISOString() })
  }),

  // --- eCTD validation (3s) + publishing ---
  http.get(`${BASE}/reg-submissions/:submissionId/ectd-validation`, async () => {
    await delay(120)
    return HttpResponse.json(validationState)
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/ectd-validation/run`, async () => {
    await delay(3000)
    return HttpResponse.json({ runAt: new Date().toISOString(), result: validationState })
  }),
  http.patch(`${BASE}/reg-submissions/:submissionId/ectd-validation/errors/:errorId/auto-fix`, async ({ request, params }) => {
    await request.json()
    await delay(180)
    validationState = {
      ...validationState,
      errors: validationState.errors.map(e => e.id === params.errorId ? { ...e, fixed: true } : e),
    }
    return HttpResponse.json({ fixedAt: new Date().toISOString() })
  }),

  // --- Redaction ---
  http.get(`${BASE}/reg-submissions/:submissionId/redaction`, async () => {
    await delay(120)
    return HttpResponse.json(redactionState)
  }),
  http.patch(`${BASE}/reg-submissions/:submissionId/redaction/items/:itemId/confirm`, async ({ request, params }) => {
    const body = await request.json() as { confirmedBy: string }
    await delay(160)
    redactionState = {
      ...redactionState,
      documents: redactionState.documents.map(d => ({
        ...d,
        ppdItems: d.ppdItems.map(p => p.id === params.itemId ? { ...p, confirmed: true, confirmedBy: body.confirmedBy, confirmedAt: new Date().toISOString() } : p),
        cciItems: d.cciItems.map(c => c.id === params.itemId ? { ...c, confirmed: true, confirmedBy: body.confirmedBy, confirmedAt: new Date().toISOString() } : c),
      })),
    }
    return HttpResponse.json({ confirmedAt: new Date().toISOString() })
  }),

  // --- Gateway ---
  http.get(`${BASE}/reg-submissions/:submissionId/gateway`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(gatewayState.filter(g => g.submissionId === params.submissionId))
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/gateway/transmit`, async ({ request, params }) => {
    const body = await request.json() as { gateway: string; partEleven: Record<string, unknown> }
    await delay(400)
    const now = new Date().toISOString()
    const created = {
      id:             `gw-${Date.now().toString(36)}`,
      submissionId:   params.submissionId as string,
      gateway:        body.gateway,
      gatewayLabel:   body.gateway === 'fda-esg' ? 'FDA ESG' : body.gateway === 'ema-cesp' ? 'EMA CESP' : body.gateway.toUpperCase(),
      status:         'pending',
      transmittedAt:  now,
      ack1At:         null,
      ack2At:         null,
      ack3At:         null,
      nackCode:       null,
      partEleven:     body.partEleven,
    }
    gatewayState = [...gatewayState, created as Record<string, unknown>]
    return HttpResponse.json(created)
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/gateway/:recordId/simulate-ack`, async ({ request, params }) => {
    const body = await request.json() as { ack: 'ack1' | 'ack2' | 'ack3' }
    await delay(300)
    const now = new Date().toISOString()
    const key = `${body.ack}At`
    gatewayState = gatewayState.map(g => g.id === params.recordId ? { ...g, [key]: now, status: body.ack } : g)
    const record = gatewayState.find(g => g.id === params.recordId)
    return HttpResponse.json(record)
  }),

  // --- HA correspondence + response drafting ---
  http.get(`${BASE}/reg-submissions/:submissionId/ha-correspondence`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(haCorrespondence.filter(h => h.submissionId === params.submissionId))
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/ha-correspondence/upload-loq`, async ({ request, params }) => {
    const body = await request.json() as { title: string; questionsCount: number }
    await delay(400)
    return HttpResponse.json({
      id:                `hac-${Date.now().toString(36)}`,
      submissionId:      params.submissionId,
      direction:         'inbound',
      type:              'loq',
      gateway:           'fda-esg',
      contentSummary:    body.title,
      receivedAt:        new Date().toISOString(),
      loqDocId:          `loq-${Date.now().toString(36)}`,
      loqDocTitle:       body.title,
      questionsExtracted: body.questionsCount,
    })
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/ha-correspondence/:correspondenceId/questions/:questionId/generate`, async ({ params }) => {
    await delay(3000)
    return HttpResponse.json({
      questionId:     params.questionId,
      responseDraft:  'Draft response grounded in canonical JSON layer. Cross-references: CSR v1.0 §14.2, SmPC §5.1. [Reviewer to refine.]',
      aiModel:        'claude-sonnet-4-6',
      aiFootprintPct: 62,
      generatedAt:    new Date().toISOString(),
    })
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/ha-correspondence/:correspondenceId/submit-response`, async ({ request, params }) => {
    await request.json()
    await delay(300)
    const h = haCorrespondence.find(x => x.id === params.correspondenceId) ?? haCorrespondence[0]
    return HttpResponse.json({ ...h, respondedAt: new Date().toISOString() })
  }),

  // --- Regulatory intelligence ---
  http.get(`${BASE}/regulatory-alerts`, async () => {
    await delay(120)
    return HttpResponse.json(alertsState)
  }),
  http.post(`${BASE}/regulatory-alerts/:alertId/acknowledge`, async ({ request, params }) => {
    const body = await request.json() as { userId: string }
    await delay(180)
    alertsState = alertsState.map(a => {
      if (a.id !== params.alertId) return a
      const ackIds = Array.isArray(a.acknowledgedByIds) ? a.acknowledgedByIds as string[] : []
      return ackIds.includes(body.userId) ? a : { ...a, acknowledgedByIds: [...ackIds, body.userId] }
    })
    return HttpResponse.json(alertsState.find(a => a.id === params.alertId))
  }),

  // --- Master Library + final ---
  http.get(`${BASE}/reg-submissions/:submissionId/library-cards`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(regulatoryLibraryCards.filter(c => c.submissionId === params.submissionId))
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/library-cards/push`, async ({ request }) => {
    const body = await request.json() as { cardIds: string[]; pushedBy: string }
    await delay(300)
    return HttpResponse.json({
      pushedAt:  new Date().toISOString(),
      cardCount: body.cardIds.length,
      pushedBy:  body.pushedBy,
    })
  }),
  http.get(`${BASE}/reg-submissions/:submissionId/final`, async ({ params }) => {
    await delay(160)
    const submission = regulatorySubmissions.find(s => s.id === params.submissionId) ?? regulatorySubmissions[0]
    const gatewayRecord = gatewayState.find(g => g.submissionId === params.submissionId && g.status === 'ack2')
      ?? gatewayState.find(g => g.submissionId === params.submissionId)
      ?? gatewayState[0]
    return HttpResponse.json({
      submission,
      gatewayRecord,
      libraryCards: regulatoryLibraryCards.filter(c => c.submissionId === params.submissionId),
      ectdNodes:    ectdGranularityMap.filter(n => n.submissionId === params.submissionId),
    })
  }),

  // --- Orphan Drug Designation ---
  http.get(`${BASE}/reg-submissions/:submissionId/odd`, async ({ params }) => {
    await delay(120)
    const record = oddAssessment.submissionId === params.submissionId
      ? oddAssessment
      : { ...oddAssessment, submissionId: params.submissionId as string }
    return HttpResponse.json(record)
  }),
  http.post(`${BASE}/reg-submissions/:submissionId/odd/sign`, async ({ request }) => {
    await request.json()
    await delay(220)
    return HttpResponse.json({
      ...oddAssessment,
      benefitDraftStatus:   'clinical-lead-signed',
      clinicalLeadSignedAt: new Date().toISOString(),
    })
  }),

  // --- Portfolio ---
  http.get(`${BASE}/projects/:projectId/reg-submissions/portfolio`, async ({ request }) => {
    await delay(150)
    const scope = new URL(request.url).searchParams.get('scope')
    if (!scope || scope === 'all' || scope === 'All projects') return HttpResponse.json(regulatorySubmissions)
    const byProject = regulatorySubmissions.filter(s => s.projectId === scope)
    if (byProject.length > 0) return HttpResponse.json(byProject)
    return HttpResponse.json(regulatorySubmissions.filter(s => s.status === scope))
  }),
]
