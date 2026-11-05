// QA regression — Informed (I) signs if named, with the meaning "acknowledged", and stays read-only elsewhere.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/36-informed-signer.spec.ts
//
// Everything is answered inside the page, so nothing reaches the API or the audit trail. Who the API
// refuses is in apps/api/src/modules/clinical-writing/informed-read-only.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-INF'
const DOC = 'DOC-E2E-INF'
const base = `/projects/${PROJECT}/clinical-writing/documents/${DOC}`

type Stub = {
  me: string
  status?: string
  chain?: 'none' | 'informed-queued' | 'informed-turn' | 'complete'
  chair?: string
}
type W = { __initiated: Array<{ signers: Array<{ signerId: string; signerRole: string; meaning: string }> }>; __signed: string[] }

async function open(page: Page, path: string, stub: Stub) {
  await page.addInitScript(({ project, doc, stub }) => {
    localStorage.setItem('clinwrite.uiLanguage', 'en')
    const w = window as unknown as W
    w.__initiated = []
    w.__signed = []
    const names: Record<string, string> = { 'u-r': 'Rita Author', 'u-c': 'Carl Reviewer', 'u-a': 'Anna Approver', 'u-i': 'Ian Informed' }
    const me = { id: stub.me, email: 'me@example.com', name: names[stub.me], role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const status = stub.status ?? 'pending-signature'
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'Informed Test', status, stage: 'cross-functional-review', version: 'v1.0',
      therapeuticArea: 'Oncology', assigneeId: 'u-r', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z', signedAt: status === 'signed' ? '2026-10-28T15:47:00Z' : null, watermarked: status !== 'signed',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Body</p>' }],
    }
    const letters: Array<[string, string]> = [['u-r', 'R'], ['u-c', 'C'], ['u-a', 'A'], ['u-i', 'I']]
    const raci = letters.map(([userId, letter]) => ({ id: `r-${userId}`, documentId: doc, userId, userName: names[userId], letter, removedAt: null }))
    const done = stub.chain === 'complete'
    const rec = (id: string, step: number, signerId: string, signerRole: string, meaning: string, s: string) => ({
      id, step, signerId, signerName: names[signerId], signerRole, meaning, status: s, scopeSections: [], timestampUtc: s === 'signed' ? '2026-10-28T15:47:00Z' : null, documentHash: s === 'signed' ? 'a'.repeat(64) : null,
    })
    const turn = stub.chain === 'informed-turn' || done
    const chains = stub.chain && stub.chain !== 'none' ? [{
      id: 'c1', chainType: 'grouped', status: done ? 'complete' : 'in_progress', initiatedBy: 'u-r', initiatedAt: '2026-10-28T10:00:00Z', completedAt: done ? '2026-10-28T15:47:00Z' : null,
      records: [
        rec('SIG-1', 1, 'u-r', 'Author', 'authored', 'signed'),
        rec('SIG-2', 2, 'u-c', 'Reviewer', 'reviewed', turn ? 'signed' : 'awaiting'),
        rec('SIG-3', 3, 'u-a', 'Approver', 'approved', turn ? 'signed' : 'queued'),
        rec('SIG-4', 4, 'u-i', 'Informed', 'acknowledged', done ? 'signed' : turn ? 'awaiting' : 'queued'),
      ],
    }] : []
    const meetings = [{
      id: 'm1', meetingRef: 'CRM-001', documentId: doc, documentTitle: 'Informed Test', version: 'v1.0', date: '2026-10-28T10:00:00Z', startTime: '15:00', endTime: '16:00', status: 'in_progress',
      startedAt: '2026-10-28T10:00:00Z', endedAt: null, chair: { userId: stub.chair ?? 'u-r', name: 'The Chair', initials: 'TC', role: 'Chair', raci: 'A', colourKey: 'TC' },
      attendees: [], pendingIds: ['CMT-1'], resolvedIds: [],
    }]
    const comments = [{ id: 'CMT-1', documentId: doc, sectionRef: '§1', severity: 'major', status: 'open', text: 'A comment', reviewerName: 'Carl', reviewerInitials: 'CR', canResolve: false, createdAt: '2026-10-20T09:00:00Z' }]
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes('/signature-records/') && method === 'POST') { w.__signed.push(url.split('/signature-records/')[1]!.split('/')[0]!); return json({ id: 'SIG-4', status: 'signed' }) }
      if (url.includes(`/documents/${doc}/final/pdf`)) return json({}, 409)
      if (url.includes(`/documents/${doc}/final`)) return json(document)
      if (url.includes(`/documents/${doc}/signature-chains`)) {
        if (method === 'POST') { w.__initiated.push(JSON.parse(String(init?.body ?? '{}'))); return json({ error: 'chain_already_active' }, 409) }
        return json(chains)
      }
      if (url.includes(`/documents/${doc}/compliance-summary`)) return json({ documentId: doc, checklistTemplateVersion: 1, generatedAt: '2026-11-01T00:00:00Z', frameworks: [], waivedMandatory: [], removedMandatory: [] })
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: stub.me === 'u-r' })
      if (url.includes(`/documents/${doc}/raci`)) return json(raci)
      if (url.includes(`/documents/${doc}/crm/access`)) return json({ canSchedule: true })
      if (url.includes(`/documents/${doc}/crm`)) return json(meetings)
      if (url.includes(`/documents/${doc}/comments`)) return json(comments)
      if (url.includes(`/documents/${doc}/presence`)) return json({ sessionId: 'p1', viewers: [], sections: [], users: [], heartbeatSeconds: 60 })
      if (url.includes(`/documents/${doc}/stage`)) return json({ current: 'cross-functional-review', currentLabel: 'Cross-Functional Review', next: 'crm', nextLabel: 'CRM', terminal: false })
      if (url.includes(`/documents/${doc}/deadlines/access`)) return json({ canEditTarget: false, canEditReviewDue: false })
      if (url.includes(`/library/by-document/${doc}`)) return json([])
      if (url.includes('/crm/m1/ai-drafts')) return json({ transcript: null, drafts: [] })
      if (url.includes('/crm/m1/resolutions')) return json([])
      if (url.includes(`/projects/${project}/source-documents/access`)) return json({ canView: false, canUpload: false })
      if (new RegExp(`/projects/${project}/documents(\\?.*)?$`).test(url)) return json([document])
      if (url.includes(`/projects/${project}/assignable-users`)) return json(Object.entries(names).map(([id, name]) => ({ id, name, email: `${id}@example.com`, projectRole: null })))
      if (url.includes(`/projects/${project}/members`)) return json(Object.keys(names).map(userId => ({ userId, removedAt: null })))
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url)) return json({ id: project, name: 'Informed Project', shortTitle: 'INF', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], team: [], createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z' })
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url)) return json(method === 'GET' ? document : {})
      if (url.includes(`/documents/${doc}/`)) return json([])
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json({ error: 'e2e_no_api' }, 503)
      return real(input, init)
    }
  }, { project: PROJECT, doc: DOC, stub })
  await page.goto(path, { waitUntil: 'domcontentloaded' })
}

test('starting a chain pre-fills the Informed person last, signing as "acknowledged"', async ({ page }) => {
  await open(page, `${base}/sign`, { me: 'u-r', chain: 'none' })
  await expect(page.locator('[data-initiate-chain]')).toBeVisible({ timeout: 60_000 })
  const row = page.locator('[data-signer-row="3"]')
  await expect(row.locator('[data-signer-select]')).toHaveValue('u-i')
  await expect(row.locator('[data-meaning-select]')).toHaveValue('acknowledged')
  await expect(row.locator('[data-meaning-select]')).toBeDisabled()
  await expect(row.locator('[data-meaning-select] option:checked')).toHaveText('Will sign as: Informed')

  await page.locator('[data-initiate-submit]').click()
  await expect(page.locator('[data-initiate-error]')).toBeVisible()
  const sent = await page.evaluate(() => (window as unknown as W).__initiated[0]!.signers)
  expect(sent.find(s => s.signerId === 'u-i')).toMatchObject({ meaning: 'acknowledged', signerRole: 'Informed' })
})

test('an Informed person cannot start a chain', async ({ page }) => {
  await open(page, `${base}/sign`, { me: 'u-i', chain: 'none' })
  await expect(page.locator('[data-start-forbidden]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-initiate-chain]')).toHaveCount(0)
})

test('before their group is released, an Informed person only watches: queued, nothing to sign, no cancel', async ({ page }) => {
  await open(page, `${base}/sign`, { me: 'u-i', chain: 'informed-queued' })
  const mine = page.locator('[data-signer-id="SIG-4"]')
  await expect(mine).toHaveAttribute('data-state', 'queued', { timeout: 60_000 })
  await expect(page.locator('[data-signer-group="acknowledged"] legend')).toHaveText('Informed')
  await expect(mine).toContainText('I have read and acknowledge this document')
  await expect(page.locator('[data-cancel-chain]')).toHaveCount(0)
  await mine.click()
  await expect(page.locator('[data-credential-input]')).toHaveCount(0)
})

test('on their turn the Informed person signs their own step, with the meaning shown', async ({ page }) => {
  await open(page, `${base}/sign`, { me: 'u-i', chain: 'informed-turn' })
  await expect(page.locator('[data-signer-id="SIG-4"]')).toHaveAttribute('data-state', 'you', { timeout: 60_000 })
  await expect(page.locator('[data-meaning="acknowledged"]')).toContainText('I have read and acknowledge this document')
  await expect(page.locator('[data-sign-submit]')).toBeDisabled()
  await page.locator('[data-credential-input]').fill('secret')
  await page.locator('[data-sign-submit]').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__signed)).toEqual(['SIG-4'])
})

test('someone else on the chain cannot sign the Informed step', async ({ page }) => {
  await open(page, `${base}/sign`, { me: 'u-r', chain: 'informed-turn' })
  const theirs = page.locator('[data-signer-id="SIG-4"]')
  await expect(theirs).toHaveAttribute('data-state', 'awaiting', { timeout: 60_000 })
  await theirs.click()
  await expect(page.locator('[data-sign-panel]')).toContainText('Only Ian Informed can sign this step.')
  await expect(page.locator('[data-credential-input]')).toHaveCount(0)
})

test('the Final Document shows the signature as Acknowledged', async ({ page }) => {
  await open(page, `${base}/final`, { me: 'u-i', chain: 'complete', status: 'signed' })
  const row = page.locator('[data-chain-banner]')
  await expect(row).toContainText('Ian Informed · Informed · Acknowledged', { timeout: 60_000 })
})

test('the document panel offers no stage advance to an Informed person, but does to the Author', async ({ page }) => {
  await open(page, `/projects/${PROJECT}/clinical-writing`, { me: 'u-i', status: 'in-review' })
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  await expect(page.locator('[data-panel="document-detail"]')).toContainText('Cross-Functional Review', { timeout: 30_000 })
  await expect(page.locator('[data-action="open-document"]')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-action="advance-stage"]')).toHaveCount(0)
})

test('the Author still gets the stage advance button', async ({ page }) => {
  await open(page, `/projects/${PROJECT}/clinical-writing`, { me: 'u-r', status: 'in-review' })
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  await expect(page.locator('[data-action="advance-stage"]')).toBeVisible({ timeout: 30_000 })
})

test('in a CRM meeting an Informed person who is not the chair changes nothing', async ({ page }) => {
  await open(page, `${base}/crm`, { me: 'u-i', status: 'crm-in-progress' })
  await expect(page.locator('[data-crm-comment="CMT-1"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-resolve="accept"]')).toBeDisabled()
  await expect(page.locator('[data-resolve-not-allowed]')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-crm-end]')).toHaveCount(0)
  await expect(page.locator('[data-action="upload-transcript"]')).toHaveCount(0)
  await expect(page.locator('[data-action="generate-minutes"]')).toHaveCount(0)
})

test('an Informed person who chairs the meeting keeps the transcript and minutes buttons', async ({ page }) => {
  await open(page, `${base}/crm`, { me: 'u-i', status: 'crm-in-progress', chair: 'u-i' })
  await expect(page.locator('[data-action="upload-transcript"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-action="generate-minutes"]')).toBeVisible()
  await expect(page.locator('[data-crm-end]')).toBeVisible()
})

test('the Reviewer View gives an Informed person no verdict buttons', async ({ page }) => {
  await open(page, `${base}/review`, { me: 'u-i', status: 'in-review' })
  await expect(page.locator('[data-screen="reviewer-view"]')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1000)
  await expect(page.locator('[data-action="approve-section"]')).toHaveCount(0)
  await expect(page.locator('[data-action="return-for-revision"]')).toHaveCount(0)
})
