// QA regression — Medical Writing screens show the item's own data, not the VELORA-301 / Veloricept demo:
// real slides, claims, Pre-MLR run, tier, reviewers, MLR decision, expiry and owner; the signed-in user instead
// of a fixed persona; and one stage / tier naming scheme. Nothing on these screens may mention the demo product.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/43-medical-writing-real-data.spec.ts
//
// /auth/me and every Medical Writing endpoint for one realistic item are answered inside the page. Any other
// API call that comes back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const P = 'PROJ-QA-MW'
const C = 'mc-qa-1'
const ME = { id: 'u-alex', email: 'alex@example.com', name: 'Alex Thornton', role: 'pm', modules: ['A', 'C'], status: 'active', lastActiveAt: null, tenantId: null }

const DEMO = /VELORA|Veloricept|Pembrolizumab|NSCLC|Dr Sarah Chen|Dr James Hartley|Dr Rebecca Morton|GPP 2022|All 48 tests|Stage 4a|FK 10 gate|AE-006|Across 3 projects|Tier 2 Standard/

type Opts = { stage?: number; withPreMlr?: boolean; withDecision?: boolean; slides?: boolean; claims?: boolean; reviewTier?: number | null }

function item(o: Opts) {
  const stage = o.stage ?? 6
  return {
    id: C, projectId: P, sourceModuleAProjectId: P, sourceModuleBPublicationId: null, type: 'pil',
    title: 'Diabetes Leaflet QA', status: stage === 6 ? 'approved' : 'briefing', stage, complianceTrack: 'promotional',
    taTag: 'Cardiometabolic', version: 'v0.4', channels: ['Print', 'Digital'], targetAudience: ['Patient'],
    reviewTier: o.reviewTier === undefined ? 1 : o.reviewTier, reviewTierOverriddenBy: null, fkScore: 7.2, fkPassed: true,
    aiFootprintPct: 35, expiryDate: stage === 6 ? '2028-11-12T00:00:00.000Z' : null, approvedAt: stage === 6 ? '2026-11-12T11:02:50.000Z' : null,
    medicalAffairsPlanId: null, publicationPlanId: null, ownerId: 'u-owner', createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-12T11:02:50.000Z',
  }
}

async function open(page: Page, path: string, o: Opts = {}) {
  const it = item(o)
  await page.addInitScript(({ me, it, o, P, C }) => {
    const slides = o.slides === false ? [] : [
      { id: 's1', deckJobId: 'd1', position: 1, title: 'What is type 2 diabetes?', bodyHtml: '<p>Your body cannot use insulin well.</p>', speakerNotes: '', aiGenerated: false, aiModel: null, aiGeneratedAt: null, aiPrompt: null, lastEditedBy: null, lastEditedAt: '2026-11-10T08:30:00.000Z', createdAt: '', updatedAt: '' },
      { id: 's2', deckJobId: 'd1', position: 2, title: 'Taking your medicine', bodyHtml: '<p>Take one tablet each morning.</p>', speakerNotes: '', aiGenerated: true, aiModel: 'claude-qa-model', aiGeneratedAt: null, aiPrompt: null, lastEditedBy: null, lastEditedAt: null, createdAt: '', updatedAt: '' },
    ]
    const claims = o.claims === false ? [] : [
      { id: 'cl1', contentItemId: C, claimText: 'Lowers HbA1c by 1.2% at 24 weeks', sourceRef: 'CSR Study 7 Table 2', sourceType: 'csr', location: 'Slide 1', approvalStatus: 'approved', reviewerId: null, similarityPct: 0, approvedLibraryText: null, adoptedAt: null },
      { id: 'cl2', contentItemId: C, claimText: 'Well tolerated', sourceRef: null, sourceType: null, location: 'Slide 2', approvalStatus: 'new', reviewerId: null, similarityPct: 0, approvedLibraryText: null, adoptedAt: null },
    ]
    const preMlr = { id: 'pm1', contentItemId: C, runAt: '2026-11-11T14:05:00.000Z', mustFixCount: 2, shouldFixCount: 1, noteCount: 0, passed: false, runBy: 'u-alex', auditEntryId: '', issues: [] }
    const decision = { id: 'dec1', decision: 'approved', decisionNote: 'ok', meaning: 'I approve this content for external distribution', decidedByName: 'Priya Lead', decidedByRole: 'tenant-admin', versionAtDecision: 'v0.4', timestampUtc: '2026-11-12T11:02:50.000Z', documentHash: 'x' }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      const m = (init?.method ?? 'GET').toUpperCase()
      if (path.endsWith('/auth/me')) return json(me)
      if (path === `/projects/${P}`) return json({ id: P, name: 'QA Diabetes Programme', shortTitle: 'QA-DIAB', status: 'ongoing', therapeuticArea: 'Cardiometabolic', tenantId: null, activeModules: ['A', 'C'], submissionCountries: [], team: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' })
      if (path === `/projects/${P}/documents`) return json([{ id: 'doc1', projectId: P, type: 'csr-full', title: 'CSR Study 7', status: 'signed', stage: 'final-output', version: 'v1.0' }])
      if (path === `/projects/${P}/assignable-users`) return json([{ id: 'u-owner', name: 'Olivia Owner', initials: 'OO', status: 'active' }])
      if (path === `/projects/${P}/med-content` || path === `/projects/${P}/med-content/portfolio`) return json([it])
      if (path.endsWith('/library/count')) return json({ total: 4 })
      const base = `/med-content/${C}`
      if (path === base && m === 'GET') return json(it)
      if (path === `${base}/slide-deck`) return json({ deck: { id: 'd1', contentItemId: C, source: 'manual', congressTarget: null, slideCountLimit: 40, status: 'ready', aiModel: 'claude-qa-model', aiFootprintPct: 35, policyVersionAtCreate: null, generatedAt: null, createdAt: '', updatedAt: '' }, slides })
      if (path === `${base}/claims`) return json(claims)
      if (path === `${base}/fk-score`) return json({ score: 7.2, passed: true, runAt: '2026-11-11T10:00:00.000Z' })
      if (path === `${base}/pre-mlr` || path === `${base}/pre-mlr/latest`) return o.withPreMlr === false ? json({ error: 'no_pre_mlr_run_yet' }, 404) : json(preMlr)
      if (path === `${base}/agentic-report`) return json({ error: 'pre_mlr_failed' }, 422)
      if (path === `${base}/mlr-reviewers`) return json([{ id: 'r1', contentItemId: C, userId: 'u-rev', name: 'Rhea Reviewer', role: 'MLR Reviewer', assignedAt: '', submittedAt: null, decision: null }])
      if (path === `${base}/mlr-comments`) return json([])
      if (path === `${base}/mlr-decision/latest`) return o.withDecision === false ? json({ error: 'not_found' }, 404) : json(decision)
      if (path === `${base}/review-tier`) return json({ id: 't', tier: 'A', reusePct: 80, calculatedAt: '' })
      if (path === `${base}/locales`) return json([])
      if (path === `${base}/kol-session`) return json({ id: 'k1', contentItemId: C, sessionDate: '2026-11-05T00:00:00.000Z', attendees: [], preReads: [], transcriptRef: null, transcriptUploadedAt: null })
      if (path === `${base}/final`) return json({ contentItem: it, libraryCards: [], expiryRecord: it.expiryDate ? { contentItemId: C, expiryDate: it.expiryDate } : undefined, approvals: [{ name: 'Priya Lead', role: 'tenant-admin', decidedAt: '2026-11-12T11:02:50.000Z' }] })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ME, it, o, P, C })
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
}

// The Editor's "In this deck now" co-editor strip is still demo data (not in scope of this fix), so it is left out.
const noDemo = async (page: Page) => {
  const text = await page.locator('[data-screen]').first().evaluate(el => {
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[data-collaborators-strip]').forEach(n => n.remove())
    return clone.innerText
  })
  expect(text).not.toMatch(DEMO)
}
const url = (sub = '') => `/projects/${P}/medical-writing/content/${C}${sub}`

test('Editor shows the item’s own slides, claims, Pre-MLR run and footprint', async ({ page }) => {
  await open(page, url('/editor'), { stage: 3 })
  await expect(page.locator('[data-deck-count]')).toContainText('2 slides', { timeout: 60_000 })
  await expect(page.locator('[data-slide-chip]')).toHaveCount(2)
  await expect(page.locator('[data-slide-title]')).toHaveText('What is type 2 diabetes?')
  await expect(page.locator('[data-slide-body]')).toHaveText('Your body cannot use insulin well.')
  await expect(page.locator('[data-pre-mlr-summary]')).toHaveText(/Last run: 14:05 UTC · 2 must-fix · 1 should-fix/)
  await expect(page.locator('[data-mustfix-gate]')).toContainText('2 must-fix findings')
  await expect(page.locator('[data-mlr-footprint-label]')).toHaveText('35% AI · 65% Human')
  await expect(page.locator('[data-claims-matrix-chip]')).toHaveText('Claims matrix: 1 of 2 approved')
  await expect(page.locator('[data-content-title]')).toContainText('Stage 3 · Internal review')
  await expect(page.locator('[data-messaging-framework-chip]')).toContainText('QA-DIAB v0.4')
  await expect(page.getByRole('button', { name: 'Go to Pre-MLR check →' })).toBeVisible()
  await page.locator('[data-tab="fk"]').click()
  await expect(page.locator('[data-fk-grade]')).toContainText('Grade 7.2')
  await expect(page.getByText('FK 10 gate')).toHaveCount(0)
  await noDemo(page)
})

test('Editor with no slides and no Pre-MLR run says so', async ({ page }) => {
  await open(page, url('/editor'), { stage: 2, slides: false, withPreMlr: false, claims: false })
  await expect(page.locator('[data-no-slides]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-canvas-empty]')).toBeVisible()
  await expect(page.locator('[data-pre-mlr-summary]')).toHaveText(/Not run yet/)
  await expect(page.locator('[data-mustfix-gate]')).toHaveCount(0)
  await expect(page.locator('[data-claims-matrix-chip]')).toHaveText('Claims matrix: no claims yet')
  await noDemo(page)
})

test('Briefing shows the linked project and its real CSR; plans show their real link state', async ({ page }) => {
  await open(page, url(''), { stage: 1 })
  await expect(page.locator('[data-source-project]')).toHaveText('Clinical Writing · QA-DIAB · Read-only', { timeout: 60_000 })
  await expect(page.locator('[data-source-doc="csr"]')).toContainText('CSR ✓')
  await expect(page.locator('[data-source-doc="ib"]')).toContainText('IB · not found')
  await expect(page.locator('[data-source-csr]')).toHaveText('CSR Study 7 v1.0 · Clinical Writing')
  await expect(page.locator('[data-map-link]')).toContainText('Not yet linked')
  await expect(page.getByRole('button', { name: /Save & go to KOL session/ })).toBeVisible()
  await noDemo(page)
})

test('Pre-MLR shows the real tier and reviewers; the PM sees no tier override', async ({ page }) => {
  await open(page, url('/pre-mlr'), { stage: 4 })
  await expect(page.locator('[data-current-tier]')).toHaveText('Tier 1 — Expedited review', { timeout: 60_000 })
  await expect(page.locator('[data-reviewer-count]')).toHaveText('1 MLR reviewer assigned')
  await expect(page.locator('[data-tier-override]')).toHaveCount(0)
  await expect(page.locator('[data-crumb-item]')).toHaveText('Diabetes Leaflet QA')
  await expect(page.getByText('Stage 4 · MLR submission', { exact: false })).toBeVisible()
  await noDemo(page)
})

test('MLR Review shows the item’s slides and claim counts, and the PM is not treated as the Lead', async ({ page }) => {
  await open(page, url('/mlr-review'), { stage: 5 })
  await expect(page.locator('[data-review-slide]')).toHaveCount(2, { timeout: 60_000 })
  await expect(page.locator('[data-review-slides]')).toContainText('Take one tablet each morning.')
  await expect(page.locator('[data-claims-tally]')).toContainText('1 approved')
  await expect(page.locator('[data-claims-tally]')).toContainText('1 new')
  await expect(page.locator('[data-header-tier]')).toHaveText('Tier 1 — Expedited review')
  await expect(page.locator('[data-lead-only]')).toHaveText('Only the MLR Lead can submit the decision.')
  await noDemo(page)
})

test('Formatting shows the real MLR decision and opens Final Output only once approved', async ({ page }) => {
  await open(page, url('/formatting'), { stage: 6 })
  await expect(page.locator('[data-mlr-approval="approved"]')).toContainText('MLR Approved · 12 Nov 2026 · Tier 1 — Expedited review', { timeout: 60_000 })
  await expect(page.locator('[data-mlr-approved-by]')).toHaveText('Priya Lead (MLR Lead) · e-signature recorded')
  await expect(page.locator('[data-format-stage]')).toHaveText('Stage 6 · Approved')
  await expect(page.getByRole('button', { name: 'Go to Final Output →' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Proceed to Stage 6/ })).toHaveCount(0)
})

test('Formatting before approval says so and keeps Final Output closed', async ({ page }) => {
  await open(page, url('/formatting'), { stage: 5, withDecision: false })
  await expect(page.locator('[data-mlr-approval="none"]')).toContainText('Not MLR-approved yet', { timeout: 60_000 })
  await expect(page.locator('[data-proceed-stage-6]')).toBeDisabled()
})

test('Final Output shows the item, its real sign-off, sources, frameworks, package and owner', async ({ page }) => {
  await open(page, url('/final'), { stage: 6 })
  await expect(page.locator('[data-final-title]')).toHaveText('Diabetes Leaflet QA', { timeout: 60_000 })
  await expect(page.locator('[data-final-subtitle]')).toHaveText('MLR Approved 12 Nov 2026 · Distribution: Print, Digital')
  await expect(page.locator('[data-signoff-name]')).toHaveText('Priya Lead (MLR Lead)')
  await expect(page.locator('[data-signoff-meaning]')).toContainText('I approve this content for external distribution')
  await expect(page.locator('[data-signoff-time]')).toContainText('12 Nov 2026 11:02 UTC')
  await expect(page.locator('[data-clinical-sources]')).toContainText('CSR Study 7 v1.0')
  await expect(page.locator('[data-files-list]')).toContainText('Diabetes_Leaflet_QA_v0.4.pdf')
  await expect(page.locator('[data-expiry-date]')).toHaveText('12 Nov 2028')
  await expect(page.locator('[data-alert-recipients]')).toHaveText('Olivia Owner (content owner)')
  await expect(page.locator('[data-frameworks-applied]')).toContainText('IFPMA')
  await expect(page.getByText('Clinical Writing · Clinical Writing')).toHaveCount(0)
  await expect(page.locator('[data-final-output-record], [data-compliance-provenance]').first()).not.toContainText(DEMO)
})

test('Portfolio places the approved item in Approved, with its real chips, expiry and library count', async ({ page }) => {
  await open(page, `/projects/${P}/medical-writing/portfolio`, { stage: 6 })
  await expect(page.locator('[data-lane="approved"] [data-portfolio-card]')).toHaveCount(1, { timeout: 60_000 })
  const card = page.locator(`[data-portfolio-card="${C}"]`)
  await expect(card.locator('[data-chip="fk"]')).toHaveText('FK 7.2 ✓')
  await expect(card.locator('[data-chip="tier"]')).toHaveText('MLR Tier 1')
  await expect(card.locator('[data-chip="mlr"]')).toBeVisible()
  await expect(card.locator('[data-chip="expiry"]')).toHaveText('Expires 12 Nov 2028')
  await expect(page.locator('[data-next-expiry]')).toContainText('Diabetes Leaflet QA')
  await expect(page.locator('[data-library-count]')).toHaveText('4 approved Medical Writing entries')
  await expect(page.locator('[data-upcoming-none]')).toBeVisible()
  await noDemo(page)
})

test('Home tabs count items by their real stage', async ({ page }) => {
  await open(page, `/projects/${P}/medical-writing`, { stage: 6 })
  await expect(page.getByRole('button', { name: /Stage 6 \(Approved\)\s*1/ })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Stage 2 \(Drafting\)\s*0/ })).toBeVisible()
  await expect(page.getByText('GPP 2022')).toHaveCount(0)
})
