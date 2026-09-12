import { http, HttpResponse, delay } from 'msw'
import publications      from '../../data/publications.json'
import publicationAuthors from '../../data/publicationAuthors.json'
import citations         from '../../data/citations.json'
import submissionChecks  from '../../data/submissionChecks.json'
import reviewRound       from '../../data/reviewRound.json'
import reviewComments    from '../../data/reviewComments.json'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const publicationHandlers = [
  // Publications — list (per project) + get + create
  http.get(`${BASE}/projects/:projectId/publications`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json(publications.filter(p => p.projectId === params.projectId))
  }),
  // Portfolio (B10) — filtered by scope
  http.get(`${BASE}/projects/:projectId/publications/portfolio`, async ({ request }) => {
    await delay(150)
    const scope = new URL(request.url).searchParams.get('scope') ?? 'All projects'
    const scopeMap: Record<string, string> = {
      'VELORA-301':  'proj-velora-301',
      'VELORA-302':  'proj-velora-302',
      'AURELIA-101': 'proj-aurelia-101',
    }
    const target = scopeMap[scope]
    const list = target ? publications.filter(p => p.projectId === target) : publications
    return HttpResponse.json(list)
  }),
  http.post(`${BASE}/projects/:projectId/publications/gpp-report`, async () => {
    await delay(800)
    return HttpResponse.json({
      reportId:      `gpp-${Date.now().toString(36)}`,
      generatedAt:   new Date().toISOString(),
      publications:  publications.length,
      compliancePct: Math.round((publications.filter(p => p.gpp2022 === 'submitted' || p.gpp2022 === 'complete').length / publications.length) * 100),
    })
  }),
  http.get(`${BASE}/publications`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const list = projectId ? publications.filter(p => p.projectId === projectId) : publications
    return HttpResponse.json(list)
  }),
  http.get(`${BASE}/publications/:publicationId`, async ({ params }) => {
    await delay(120)
    const pub = publications.find(p => p.id === params.publicationId)
    return pub
      ? HttpResponse.json(pub)
      : HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),
  http.post(`${BASE}/publications`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(500)
    const now = new Date().toISOString()
    return HttpResponse.json({
      id: `pub-${Date.now().toString(36)}`,
      stage: 'planning',
      status: 'not-started',
      version: '—',
      createdAt: now,
      updatedAt: now,
      ...body,
    }, { status: 201 })
  }),
  http.patch(`${BASE}/publications/:publicationId`, async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(300)
    const pub = publications.find(p => p.id === params.publicationId)
    return HttpResponse.json({ ...pub, ...body, updatedAt: new Date().toISOString() })
  }),

  // AI Footprint
  http.get(`${BASE}/publications/:publicationId/footprint`, async () => {
    await delay(120)
    return HttpResponse.json({
      totalAiPercent:   34,
      totalHumanPercent: 66,
      breakdown: [
        { label: 'Introduction', aiPercent: 0  },
        { label: 'Methods',      aiPercent: 45 },
        { label: 'Results',      aiPercent: 52 },
        { label: 'Discussion',   aiPercent: 0  },
      ],
    })
  }),

  // Authors
  http.get(`${BASE}/publications/:publicationId/authors`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(publicationAuthors.filter(a => a.publicationId === params.publicationId))
  }),
  http.post(`${BASE}/publications/:publicationId/authors`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(400)
    return HttpResponse.json({
      id: `author-${Date.now().toString(36)}`,
      addedAt: new Date().toISOString(),
      coiStatus: 'pending',
      debarmentStatus: 'unchecked',
      icmjeCriteria: [],
      icmjeAcknowledged: false,
      ...body,
    }, { status: 201 })
  }),
  http.patch(`${BASE}/publications/:publicationId/authors/:authorId`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(200)
    return HttpResponse.json({ ...body, updatedAt: new Date().toISOString() })
  }),
  http.post(`${BASE}/publications/:publicationId/authors/:authorId/debarment-check`, async () => {
    await delay(900)
    return HttpResponse.json({ debarmentStatus: 'clear', debarmentCheckedAt: new Date().toISOString() })
  }),
  http.post(`${BASE}/publications/:publicationId/debarment-check`, async () => {
    await delay(1500)
    return HttpResponse.json({
      checkedAt:     new Date().toISOString(),
      authorsChecked: 4,
      matches:       0,
      sources:       ['FDA Debarment List', 'OIG Excluded Individuals'],
    })
  }),
  http.patch(`${BASE}/publications/:publicationId/authors/:authorId/icmje`, async ({ request }) => {
    const body = await request.json() as { criterionIndex: number; met: boolean; confirmedBy?: string }
    await delay(200)
    return HttpResponse.json({
      criterionIndex: body.criterionIndex,
      met:            body.met,
      confirmedBy:    body.confirmedBy ?? 'Dr Sarah Chen',
      confirmedAt:    new Date().toISOString(),
    })
  }),
  http.post(`${BASE}/publications/:publicationId/authors/:authorId/icmje/acknowledge`, async ({ request }) => {
    const body = await request.json() as { acknowledgedBy?: string }
    await delay(250)
    return HttpResponse.json({
      icmjeAcknowledged:   true,
      icmjeAcknowledgedBy: body.acknowledgedBy ?? 'Dr Sarah Chen',
      icmjeAcknowledgedAt: new Date().toISOString(),
    })
  }),
  http.post(`${BASE}/publications/:publicationId/authors/:authorId/remind`, async () => {
    await delay(220)
    return HttpResponse.json({ remindedAt: new Date().toISOString() })
  }),

  // Citations
  http.get(`${BASE}/publications/:publicationId/citations`, async ({ params }) => {
    await delay(120)
    return HttpResponse.json(citations.filter(c => c.publicationId === params.publicationId))
  }),
  http.post(`${BASE}/publications/:publicationId/citations`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(300)
    return HttpResponse.json({
      id: `cit-${Date.now().toString(36)}`,
      insertedAt: new Date().toISOString(),
      isSourceDocument: false,
      ...body,
    }, { status: 201 })
  }),
  http.delete(`${BASE}/publications/:publicationId/citations/:citationId`, async () => {
    await delay(200)
    return HttpResponse.json({ removedAt: new Date().toISOString() })
  }),
  http.get(`${BASE}/pubmed/search`, async ({ request }) => {
    await delay(400)
    const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''
    // Curated PubMed records for B04 — includes abstracts + keyword hooks
    const PUBMED_RECORDS = [
      {
        id: 'gandhi',
        pmid: 'PMID: 29658856',
        title: 'Pembrolizumab plus chemotherapy in metastatic non–small-cell lung cancer',
        source: 'Gandhi L et al. · N Engl J Med · 2018',
        shortRef: 'Gandhi L et al., NEJM 2018',
        fullRef: 'Gandhi L, Rodríguez-Abreu D, Gadgeel S, et al. Pembrolizumab plus chemotherapy in metastatic non–small-cell lung cancer. N Engl J Med. 2018;378(22):2078–2092.',
        abstractText: 'In this double-blind Phase III trial, 616 patients with untreated metastatic non-squamous NSCLC were randomised to pembrolizumab or placebo plus pemetrexed–platinum. Overall survival at 12 months was 69.2% versus 49.4%.',
        keys: 'pembrolizumab chemotherapy nsclc metastatic survival progression',
      },
      {
        id: 'socinski',
        pmid: 'PMID: 33764809',
        title: 'First-line pembrolizumab plus pemetrexed and platinum in lung cancer',
        source: 'Socinski M et al. · J Clin Oncol · 2021',
        shortRef: 'Socinski M et al., JCO 2021',
        fullRef: 'Socinski MA, Jotte RM, Cappuzzo F, et al. First-line pembrolizumab plus pemetrexed and platinum in lung cancer. J Clin Oncol. 2021;39(21):2339–2349.',
        abstractText: 'Updated analysis of first-line pembrolizumab combination therapy across PD-L1 expression subgroups, reporting a progression-free survival hazard ratio of 0.56 in the intention-to-treat population.',
        keys: 'pembrolizumab pemetrexed platinum first-line lung progression-free survival',
      },
      {
        id: 'garassino',
        pmid: 'PMID: 33035649',
        title: 'KEYNOTE-189: updated OS and progression after the next line of therapy',
        source: 'Garassino M et al. · J Thorac Oncol · 2020',
        shortRef: 'Garassino M et al., JTO 2020',
        fullRef: 'Garassino MC, Gadgeel S, Esteban E, et al. KEYNOTE-189: updated overall survival and progression after the next line of therapy. J Thorac Oncol. 2020;15(10):1657–1669.',
        abstractText: 'Long-term follow-up reporting PFS2 and overall survival benefit maintained at a median follow-up of 31 months, with no new safety signals identified.',
        keys: 'keynote-189 overall survival progression next line pembrolizumab nsclc',
      },
      {
        id: 'hellmann',
        pmid: 'PMID: 31562796',
        title: 'Nivolumab plus ipilimumab in advanced non–small-cell lung cancer',
        source: 'Hellmann M et al. · N Engl J Med · 2019',
        shortRef: 'Hellmann M et al., NEJM 2019',
        fullRef: 'Hellmann MD, Paz-Ares L, Bernabe Caro R, et al. Nivolumab plus ipilimumab in advanced non–small-cell lung cancer. N Engl J Med. 2019;381(21):2020–2031.',
        abstractText: 'Dual checkpoint blockade in advanced NSCLC demonstrated improved overall survival versus chemotherapy irrespective of PD-L1 expression level.',
        keys: 'nivolumab ipilimumab advanced nsclc checkpoint survival',
      },
    ]
    if (q.length < 3) return HttpResponse.json({ results: [] })
    const terms = q.split(/\s+/).filter(t => t.length > 2)
    const matched = PUBMED_RECORDS.filter(r => {
      const hay = `${r.title} ${r.source} ${r.keys}`.toLowerCase()
      return terms.length === 0 || terms.some(t => hay.includes(t))
    })
    return HttpResponse.json({ results: matched, fetchedAt: new Date().toISOString() })
  }),

  // Submission checks
  http.get(`${BASE}/publications/:publicationId/submission-checks`, async () => {
    await delay(150)
    const summary = {
      total: submissionChecks.length,
      pass:  submissionChecks.filter(c => c.state === 'pass').length,
      warn:  submissionChecks.filter(c => c.state === 'warn').length,
      block: submissionChecks.filter(c => c.state === 'block').length,
      ack:   submissionChecks.filter(c => c.state === 'ack').length,
    }
    return HttpResponse.json({ summary, checks: submissionChecks })
  }),
  http.post(`${BASE}/publications/:publicationId/submission-checks/run`, async () => {
    await delay(1600)
    return HttpResponse.json({ startedAt: new Date().toISOString(), checks: submissionChecks })
  }),
  http.patch(`${BASE}/publications/:publicationId/submission-checks/:checkId`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(200)
    return HttpResponse.json({ ...body, resolvedAt: new Date().toISOString() })
  }),

  // Peer review
  http.get(`${BASE}/publications/:publicationId/review-rounds`, async ({ params }) => {
    await delay(120)
    const rounds = reviewRound.publicationId === params.publicationId ? [reviewRound] : []
    return HttpResponse.json(rounds)
  }),
  http.get(`${BASE}/review-rounds/:roundId/comments`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json(reviewComments.filter(c => c.roundId === params.roundId))
  }),
  http.patch(`${BASE}/review-rounds/:roundId/comments/:commentId`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(250)
    return HttpResponse.json({ ...body, respondedAt: new Date().toISOString() })
  }),
  http.post(`${BASE}/review-rounds/:roundId/comments/:commentId/ai-draft`, async () => {
    await delay(1400)
    return HttpResponse.json({
      responseText: 'We thank the reviewer for this comment. [AI-drafted response placeholder — Phase 1 stub.]',
      aiDrafted: true,
      aiModel: 'claude-sonnet-4-6',
      aiGeneratedAt: new Date().toISOString(),
    })
  }),

  // Congress abstract export (B07 stub)
  http.post(`${BASE}/publications/:publicationId/congress-export`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    await delay(600)
    return HttpResponse.json({
      exportId: `exp-${Date.now().toString(36)}`,
      format:   body.format ?? 'pdf',
      congress: body.congress ?? 'ASCO',
      createdAt: new Date().toISOString(),
    })
  }),

  // Final output (B09)
  http.get(`${BASE}/publications/:publicationId/final`, async ({ params }) => {
    await delay(150)
    return HttpResponse.json({
      publicationId: params.publicationId,
      journal:       'Journal of Clinical Oncology',
      publishedDate: '2027-01-14',
      articleUrl:    'https://jco.example.com/velora301',
      citation:      'Webb M, Hartley J, Chen S, Vasquez E, Nair P. PFS benefit of veloricept plus pembrolizumab in previously untreated advanced non–small-cell lung cancer: results of the Phase III VELORA-301 trial. <em>Journal of Clinical Oncology</em>. 2027;45(2):128–139. doi:10.1200/JCO.2026.VELORA301',
      doi:           '10.1200/JCO.2026.VELORA301',
      doiRegisteredAt: '2027-01-14',
      orcids: [
        { name: 'Marcus Webb',         initials: 'MW', orcid: '0000-0002-1825-0097', avatarBg: '#CCFBF1', avatarFg: '#0F766E' },
        { name: 'Prof. James Hartley', initials: 'JH', orcid: '0000-0001-5109-3700', avatarBg: '#F1F5F9', avatarFg: '#475569' },
        { name: 'Dr Sarah Chen',       initials: 'SC', orcid: '0000-0003-2707-9852', avatarBg: '#F5F3FF', avatarFg: '#7C3AED' },
        { name: 'Dr Elena Vasquez',    initials: 'EV', orcid: '0000-0002-9079-5933', avatarBg: '#DBEAFE', avatarFg: '#1D4ED8' },
        { name: 'Dr Priya Nair',       initials: 'PN', orcid: '0000-0001-7205-4462', avatarBg: '#FEF3C7', avatarFg: '#B45309' },
      ],
      packageFiles: [
        { name: 'Final accepted manuscript (PDF)',        note: 'Formatted to JCO specification' },
        { name: 'EQUATOR checklist (PDF)',                note: 'CONSORT 2010 · 25/25 items complete' },
        { name: 'Author COI disclosures (PDF)',           note: '5 authors · ICMJE format' },
        { name: 'ICMJE contribution statements (PDF)',    note: 'All four criteria confirmed — soft gate resolved 12 Dec 2026' },
        { name: 'GPP 2022 publication record (PDF)',      note: 'Full audit trail export' },
        { name: 'Compliance provenance record (PDF)',     note: 'Cross-module 21 CFR Part 11 audit chain', crossModule: true },
      ],
      provenanceChain: {
        sourceRecord: [
          { label: 'VELORA-301 clinical study report v1.0', meta: 'Signed 28 Oct 2026' },
          { label: 'Statistical analysis plan v2.0',        meta: 'Signed 15 Sep 2026' },
          { label: 'TLF package v3',                        meta: 'Validated 10 Oct 2026' },
          { label: 'Audit trail reference',                 meta: 'AE-006 → AE-012' },
        ],
        publicationRecord: [
          { label: 'Manuscript v0.1 created',                   meta: '05 Nov 2026 · Marcus Webb' },
          { label: 'Internal review completed',                 meta: '20 Nov 2026' },
          { label: 'External author review completed',          meta: '02 Dec 2026' },
          { label: 'Steering committee approval',               meta: '05 Dec 2026 · e-signature on file' },
          { label: 'Submitted to Journal of Clinical Oncology', meta: '15 Dec 2026' },
          { label: 'Published',                                 meta: '14 Jan 2027', current: true },
        ],
      },
      libraryCards: [
        { name: 'Manuscript abstract',       note: 'Tagged: Oncology · NSCLC · Phase III' },
        { name: 'Primary endpoint result',   note: 'HR 0.61 (95% CI 0.48–0.77) · source Table 14.2.1' },
        { name: 'EQUATOR checklist record',  note: 'CONSORT 2010 · complete' },
        { name: 'Publication citation',      note: 'DOI 10.1200/JCO.2026.VELORA301' },
      ],
      statusRows: [
        { label: 'Stage',                value: 'Stage 6 · final output',        fg: '#1E293B' },
        { label: 'Planning → published', value: '71 days',                       fg: '#1E293B' },
        { label: 'GPP 2022',             value: 'Compliant ✓',                   fg: '#15803D' },
        { label: 'ICMJE',                value: 'Compliant ✓',                   fg: '#15803D' },
        { label: '21 CFR Part 11',       value: 'Audit chain complete ✓',        fg: '#15803D' },
      ],
    })
  }),
  http.post(`${BASE}/publications/:publicationId/final/download`, async () => {
    await delay(250)
    return HttpResponse.json({
      downloadId: `dl-${Date.now().toString(36)}`,
      fileCount:  6,
      createdAt:  new Date().toISOString(),
    })
  }),
]
