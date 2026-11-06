// QA regression — with the language set to Japanese, the E-Signature, Final Document, CRM, guest review
// and document detail screens show no English of their own. Each test reads the screen's visible text and
// fails on any English word that isn't the document's data or a term kept in English on purpose (CRM, RACI ...).
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/35-clinical-writing-japanese.spec.ts
//
// Everything is answered inside the page, so nothing reaches the API or the audit trail.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-JA'
const DOC = 'DOC-E2E-JA'
const base = `/projects/${PROJECT}/clinical-writing/documents/${DOC}`

// Data in the stubs, which stays as entered.
const DATA = ['JA Test Document', 'Asha Rao', 'Ben Ito', 'Cara Mori', 'SIG-1', 'SIG-2', 'SIG-3', 'CMT-1', 'CMT-2', 'CMT-3', 'u-me', 'Synopsis', 'SYNOPSIS', 'Body text', 'Please clarify the dose', 'Check the table',
  'ICH E3', 'Section present', 'Tables listed', 'A waived item', 'A removed item', 'Not needed', 'Replaced', 'Global', 'guest@example.com', 'External review', 'Accepted as written', 'Cancelled for rework', 'CRM-001', 'Oncology', 'Otter.ai']
// Kept in English in the Japanese text as well: product names, acronyms and regulation names.
const ALLOWED = /^(CRM|RACI|Responsible|SHA|UTC|CFR|Part|Annex|QC|AI|ID|ICH|HTML|PDF|Esc|Zoom|Microsoft|Teams|Otter|CSR|AR|BI|CM)$/

type Stub = {
  status?: string
  chain?: 'none' | 'active' | 'complete' | 'cancelled'
  meeting?: 'none' | 'in_progress' | 'complete'
  refusePdf?: boolean
  letter?: string
}

async function open(page: Page, path: string, stub: Stub = {}, language = 'ja') {
  await page.addInitScript(({ project, doc, stub, language }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    const w = window as unknown as { __initiated: unknown[] }
    w.__initiated = []
    const me = { id: 'u-me', email: 'me@example.com', name: 'Asha Rao', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const status = stub.status ?? 'pending-signature'
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'JA Test Document', status, stage: 'cross-functional-review', version: 'v1.0',
      therapeuticArea: 'Oncology', assigneeId: 'u-me', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z', signedAt: status === 'signed' ? '2026-10-28T15:47:00Z' : null, watermarked: status !== 'signed',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Body text</p>' }, { id: 's2', number: '2', title: 'Synopsis', status: 'complete', contentHtml: '' }],
    }
    const record = (id: string, step: number, signerId: string, signerName: string, signerRole: string, meaning: string, s: string) => ({
      id, step, signerId, signerName, signerRole, meaning, status: s, scopeSections: [], timestampUtc: s === 'signed' ? '2026-10-28T15:47:00Z' : null, documentHash: s === 'signed' ? 'a'.repeat(64) : null,
    })
    const chains = stub.chain === 'active' ? [{
      id: 'c1', chainType: 'grouped', status: 'in_progress', initiatedBy: 'u-me', initiatedAt: '2026-10-28T10:00:00Z',
      records: [record('SIG-1', 1, 'u-ben', 'Ben Ito', 'Author', 'authored', 'signed'), record('SIG-2', 2, 'u-me', 'Asha Rao', 'Reviewer', 'reviewed', 'awaiting'), record('SIG-3', 3, 'u-cara', 'Cara Mori', 'Approver', 'approved', 'queued')],
    }] : stub.chain === 'complete' ? [{
      id: 'c1', chainType: 'grouped', status: 'complete', initiatedBy: 'u-me', initiatedAt: '2026-10-28T10:00:00Z', completedAt: '2026-10-28T15:47:00Z',
      records: [record('SIG-1', 1, 'u-ben', 'Ben Ito', 'Approver', 'approved', 'signed')],
    }] : stub.chain === 'cancelled' ? [{
      id: 'c1', chainType: 'grouped', status: 'cancelled', cancelReason: 'Cancelled for rework', initiatedBy: 'u-me', initiatedAt: '2026-10-28T10:00:00Z', records: [],
    }] : []
    const raci = [
      { id: 'r1', documentId: doc, userId: 'u-me', userName: 'Asha Rao', letter: stub.letter ?? 'R', removedAt: null },
      { id: 'r2', documentId: doc, userId: 'u-cara', userName: 'Cara Mori', letter: 'A', removedAt: null },
    ]
    const comments = [
      { id: 'CMT-1', documentId: doc, sectionRef: '§1', severity: 'major', status: 'open', text: 'Please clarify the dose', reviewerName: 'Ben Ito', reviewerInitials: 'BI', canResolve: true, createdAt: '2026-10-20T09:00:00Z' },
      { id: 'CMT-2', documentId: doc, sectionRef: '§2', severity: 'minor', status: 'open', text: 'Check the table', reviewerName: 'Cara Mori', reviewerInitials: 'CM', canResolve: true, createdAt: '2026-10-20T09:00:00Z' },
      { id: 'CMT-3', documentId: doc, sectionRef: '§1', severity: 'query', status: 'resolved', text: '', reviewerName: 'Ben Ito', reviewerInitials: 'BI', canResolve: true, createdAt: '2026-10-20T09:00:00Z' },
    ]
    const meetings = stub.meeting === 'in_progress' || stub.meeting === 'complete' ? [{
      id: 'm1', meetingRef: 'CRM-001', documentId: doc, documentTitle: 'JA Test Document', version: 'v1.0', date: '2026-10-28T10:00:00Z', startTime: '15:00', endTime: '16:00', status: stub.meeting,
      startedAt: '2026-10-28T10:00:00Z', endedAt: stub.meeting === 'complete' ? '2026-10-28T11:00:00Z' : null, chair: { id: 'u-me', name: 'Asha Rao' },
      attendees: [{ userId: 'u-me', name: 'Asha Rao', initials: 'AR', role: 'Chair' }, { userId: 'u-ben', name: 'Ben Ito', initials: 'BI', role: 'Reviewer' }],
      pendingIds: stub.meeting === 'complete' ? [] : ['CMT-1', 'CMT-2'], resolvedIds: ['CMT-3'],
    }] : []
    const compliance = {
      documentId: doc, checklistTemplateVersion: 3, generatedAt: '2026-11-01T00:00:00Z',
      frameworks: [{ name: 'ICH E3', version: null, jurisdiction: 'Global', sourceUrl: null, inRegistry: false, rules: [
        { text: 'Section present', mandatory: true, status: 'complete' }, { text: 'Tables listed', mandatory: false, status: 'pending' },
      ] }],
      waivedMandatory: [{ text: 'A waived item', framework: 'ICH E3', waivedBy: 'Ben Ito', waivedAt: '2026-10-20T09:00:00Z', reason: 'Not needed' }],
      removedMandatory: [{ text: 'A removed item', framework: 'ICH E3', removedBy: 'Ben Ito', removedAt: '2026-10-20T09:00:00Z', reason: 'Replaced' }],
    }
    const guestDoc = {
      guest: { email: 'guest@example.com', purpose: 'External review', expiresAt: '2026-12-01T09:00:00Z' },
      document: { id: doc, title: 'JA Test Document', type: 'csr_full', status: 'in_review' },
      sections: [{ sectionId: 's1', sectionNumber: '1', sectionTitle: 'Synopsis', contentHtml: '<p>Body text</p>' }, { sectionId: 's2', sectionNumber: '2', sectionTitle: 'Synopsis', contentHtml: '' }],
      comments: [{ id: 'G-1', sectionRef: '§1', text: 'Check the table', status: 'open', createdAt: '2026-10-20T09:00:00Z' }, { id: 'CMT-1', sectionRef: '§1', text: 'Please clarify the dose', status: 'resolved', createdAt: '2026-10-20T09:00:00Z' }],
    }
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes('/guest/verify/expired') || url.includes('/guest/document/expired')) return json({ error: 'revoked', message: 'This invitation was revoked.' }, 410)
      if (url.includes('/guest/verify/')) return json({ scope: 'document', documentId: doc })
      if (url.includes('/guest/document/')) return json(guestDoc)
      if (url.includes(`/documents/${doc}/final/pdf`)) return json({ error: 'signed_content_changed', message: 'server words' }, 409)
      if (url.includes(`/documents/${doc}/final`)) return json(document)
      if (url.includes(`/documents/${doc}/signature-chains`)) {
        if (method === 'POST') { w.__initiated.push(JSON.parse(String(init?.body ?? '{}'))); return json({ error: 'chain_already_active', chainId: 'c9' }, 409) }
        return json(chains)
      }
      if (url.includes(`/documents/${doc}/compliance-summary`)) return json(compliance)
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: true })
      if (url.includes(`/documents/${doc}/raci`)) return json(raci)
      if (url.includes(`/documents/${doc}/crm/access`)) return json({ canSchedule: true })
      if (url.includes(`/documents/${doc}/crm`)) return json(meetings)
      if (url.includes(`/documents/${doc}/comments`)) return json(comments)
      if (url.includes(`/documents/${doc}/stage`)) return json({ current: 'cross-functional-review', currentLabel: 'Cross-Functional Review', next: 'crm', nextLabel: 'CRM', terminal: false })
      if (url.includes(`/documents/${doc}/deadlines/access`)) return json({ canEditTarget: false, canEditReviewDue: false })
      if (url.includes(`/library/by-document/${doc}`)) return json([])
      if (url.includes('/crm/m1/ai-drafts')) return json({ transcript: { wordCount: 1200, source: 'zoom_native', uploadedAt: '2026-10-28T10:00:00Z' }, drafts: [{ commentId: 'CMT-1', draftText: 'Accepted as written' }] })
      if (url.includes('/crm/m1/resolutions')) return json([{ id: 'res1', commentId: 'CMT-3', resolutionType: 'accept_with_modification', resolutionNote: 'Accepted as written', resolvedBy: 'u-me', resolvedAt: '2026-10-28T10:30:00Z' }])
      if (url.includes(`/projects/${project}/source-documents/access`)) return json({ canView: false, canUpload: false })
      if (new RegExp(`/projects/${project}/documents(\\?.*)?$`).test(url)) return json([document])
      if (new RegExp(`/projects/${project}/assignable-users`).test(url)) return json([{ id: 'u-me', name: 'Asha Rao', email: 'me@example.com', projectRole: null }, { id: 'u-cara', name: 'Cara Mori', email: 'c@example.com', projectRole: null }])
      if (new RegExp(`/projects/${project}/members`).test(url)) return json([{ userId: 'u-me', removedAt: null }, { userId: 'u-cara', removedAt: null }])
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url)) return json({ id: project, name: 'JA Project', shortTitle: 'JA', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], team: [], createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z' })
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url)) return json(method === 'GET' ? document : {})
      if (url.includes(`/documents/${doc}/`)) return json([])
      // Nothing reaches the real API, so no real data shows up in the text being checked.
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json({ error: 'e2e_no_api' }, 503)
      return real(input, init)
    }
  }, { project: PROJECT, doc: DOC, stub, language })
  await page.goto(path, { waitUntil: 'domcontentloaded' })
}

async function expectNoEnglish(page: Page, selector: string) {
  const el = page.locator(selector).first()
  await expect(el).toBeVisible({ timeout: 60_000 })
  let text = await el.evaluate(n => (n as HTMLElement).innerText)
  // Hover text and placeholders count too.
  text += '\n' + await el.evaluate(n => [...n.querySelectorAll('[title],[placeholder],[aria-label]')].map(e => ['title', 'placeholder', 'aria-label'].map(a => e.getAttribute(a) ?? '').join(' ')).join('\n'))
  text = text.replace(await page.evaluate(() => navigator.userAgent.slice(0, 60)), '')
  for (const d of DATA) text = text.split(d).join(' ')
  text = text.replace(/\ba{4,}\b/g, ' ') // the stubbed document hash
  const words = [...text.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]).filter(w => !ALLOWED.test(w))
  expect([...new Set(words)], `English left on ${selector}:\n${text.slice(0, 1500)}`).toEqual([])
}

const shot = (page: Page, name: string) => (process.env.E2E_SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: false }) : Promise.resolve())

test('E-Signature: chain in progress, your step, queued step and signed record', async ({ page }) => {
  await open(page, `${base}/sign`, { chain: 'active' })
  await expect(page.locator('[data-sign-panel]')).toBeVisible({ timeout: 60_000 })
  await shot(page, 'esign-you')
  await expectNoEnglish(page, '[data-screen="e-signature"]')
  await page.locator('[data-signer-id="SIG-3"]').click()
  await expect(page.locator('[data-signer-id="SIG-3"]')).toHaveAttribute('data-selected', 'true')
  await expectNoEnglish(page, '[data-screen="e-signature"]')
  await page.locator('[data-signer-id="SIG-1"]').click()
  await expect(page.locator('[data-signer-id="SIG-1"]')).toHaveAttribute('data-selected', 'true')
  await expectNoEnglish(page, '[data-screen="e-signature"]')
  await page.locator('[data-cancel-chain]').click()
  await expect(page.locator('[data-cancel-form]')).toBeVisible()
  await expectNoEnglish(page, '[data-screen="e-signature"]')
})

test('E-Signature: completed chain', async ({ page }) => {
  await open(page, `${base}/sign`, { chain: 'complete', status: 'signed' })
  await expect(page.locator('[data-chain-complete]')).toBeVisible({ timeout: 60_000 })
  await expectNoEnglish(page, '[data-screen="e-signature"]')
})

test('Initiate signature chain: the form is Japanese, but what is saved on the record stays English', async ({ page }) => {
  await open(page, `${base}/sign`, { chain: 'cancelled' })
  await expect(page.locator('[data-initiate-chain]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-chain-cancelled]')).toContainText('キャンセル')
  await expect(page.locator('[data-signer-row="1"]')).toBeVisible({ timeout: 30_000 })
  await shot(page, 'initiate')
  await expectNoEnglish(page, '[data-screen="e-signature"]')
  await page.locator('[data-add-signer]').click()
  await page.locator('[data-signer-search]').fill('ab')
  await expect(page.locator('[data-signer-results]')).toContainText('3')
  await expectNoEnglish(page, '[data-screen="e-signature"]')
  await page.locator('[data-signer-row="2"] button[aria-label]').last().click()

  await page.locator('[data-initiate-submit]').click()
  await expect(page.locator('[data-initiate-error]')).toContainText('有効な署名チェーン')
  const sent = await page.evaluate(() => (window as unknown as { __initiated: Array<{ signers: Array<{ signerRole: string }> }> }).__initiated)
  expect(sent[0]!.signers.map(s => s.signerRole).sort()).toEqual(['Approver', 'Author'])
})

for (const [name, status, hint] of [['in authoring', 'in-authoring', '作成中'], ['in review', 'in-review', 'レビュー中']] as const) {
  test(`Initiate signature chain: blocked while ${name}`, async ({ page }) => {
    await open(page, `${base}/sign`, { status })
    await expect(page.locator('[data-initiate-blocked]')).toContainText(hint, { timeout: 60_000 })
    await expectNoEnglish(page, '[data-screen="e-signature"]')
  })
}

test('Final Document: signed, with the compliance tables and a refused PDF', async ({ page }) => {
  await open(page, `${base}/final`, { chain: 'complete', status: 'signed' })
  await expect(page.locator('[data-waived-items]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-removed-items]')).toBeVisible()
  await page.locator('[data-chain-banner]').waitFor()
  await expect(page.locator('[data-signed-at]')).toContainText('2026年10月28日')
  await page.locator('[data-action="download-final-pdf"]').click()
  await expect(page.locator('[data-final-pdf-error]')).toContainText('署名時の内容と一致しなくなった')
  await shot(page, 'final-signed')
  await expectNoEnglish(page, '[data-screen="final-document"]')
})

test('Final Document: unsigned shows a Japanese watermark and banner', async ({ page }) => {
  await open(page, `${base}/final`, { status: 'in-review' })
  await expect(page.locator('[data-watermark]')).toContainText('ドラフト — 未署名', { timeout: 60_000 })
  await expect(page.locator('[data-signed-banner="unsigned"]')).toContainText('レビュー中')
  await shot(page, 'final-unsigned')
  await expectNoEnglish(page, '[data-screen="final-document"]')
})

test('Final Document: signed with no signature records', async ({ page }) => {
  await open(page, `${base}/final`, { status: 'signed' })
  await expect(page.locator('[data-signature-gap]')).toBeVisible({ timeout: 60_000 })
  await expectNoEnglish(page, '[data-screen="final-document"]')
})

test('CRM: meeting in progress, document viewer and transcript dialog', async ({ page }) => {
  await open(page, `${base}/crm`, { status: 'crm-in-progress', meeting: 'in_progress' })
  await expect(page.locator('[data-crm-comment="CMT-1"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-crm-log-entry]')).toBeVisible()
  await shot(page, 'crm-progress')
  await expectNoEnglish(page, '[data-screen="crm-module"]')

  await page.locator('[data-action="open-doc-viewer"]').click()
  await expect(page.locator('[data-crm-viewer-chrome]')).toBeVisible()
  await shot(page, 'crm-viewer')
  await expectNoEnglish(page, '[data-crm-doc-viewer]')
  await page.keyboard.press('Escape')

  await page.locator('[data-action="upload-transcript"]').click()
  const dialog = page.locator('[role="dialog"]')
  await expect(dialog).toBeVisible()
  await expectNoEnglish(page, '[role="dialog"]')
})

test('CRM: no meeting yet, schedule form and the blocked state', async ({ page }) => {
  await open(page, `${base}/crm`, { status: 'in-review', meeting: 'none' })
  await expect(page.locator('[data-crm-schedule]')).toBeVisible({ timeout: 60_000 })
  await expectNoEnglish(page, '[data-screen="crm-module"]')
})

test('CRM: a meeting date already passed is explained in Japanese and blocks scheduling', async ({ page }) => {
  await open(page, `${base}/crm`, { status: 'in-review', meeting: 'none' })
  await page.locator('[data-crm-date]').fill('2025-01-01', { timeout: 60_000 })
  await expect(page.locator('[data-date-past]')).toBeVisible()
  await expect(page.locator('[data-crm-schedule-submit]')).toBeDisabled()
  await expectNoEnglish(page, '[data-screen="crm-module"]')
})

test('CRM: blocked until the document is in review', async ({ page }) => {
  await open(page, `${base}/crm`, { status: 'in-authoring', meeting: 'none' })
  await expect(page.locator('[data-screen="crm-module"]')).toContainText('作成中', { timeout: 60_000 })
  await expectNoEnglish(page, '[data-screen="crm-module"]')
})

test('Guest review page is Japanese, including a refused link', async ({ page }) => {
  await open(page, '/guest/document/good-token')
  await expect(page.locator('[data-guest-review]')).toContainText('レビュー中', { timeout: 60_000 })
  await shot(page, 'guest')
  await expectNoEnglish(page, '[data-guest-review]')

  await page.goto('/guest/document/expired', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-guest-review]')).toContainText('取り消されました', { timeout: 60_000 })
  await expectNoEnglish(page, '[data-guest-review]')
})

test('Document detail panel is Japanese, with translated status, stage and next-stage labels', async ({ page }) => {
  await open(page, `/projects/${PROJECT}/clinical-writing`, { status: 'in-review' })
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  const panel = page.locator('[data-panel="document-detail"]')
  await expect(panel).toContainText('部門横断レビュー', { timeout: 30_000 })
  await expect(panel).toContainText('レビュー中')
  await expect(page.locator('[data-action="advance-stage"]')).toContainText('CRM')
  await shot(page, 'detail-panel')
  await expectNoEnglish(page, '[data-panel="document-detail"]')
})

test('in English the same screens read as before, with no raw translation keys', async ({ page }) => {
  await open(page, `${base}/sign`, { chain: 'active' }, 'en')
  const esign = page.locator('[data-screen="e-signature"]')
  await expect(esign).toContainText('Awaiting your signature', { timeout: 60_000 })
  await expect(esign).toContainText('I have reviewed this document')
  await expect(esign).toContainText('Final Document unlocks when all signatures are recorded. 2 of 3 still missing.')
  await expect(page.locator('[data-sign-submit]')).toHaveText('Sign document')
  await expect(page.locator('[data-signature-progress]')).toHaveText('1 of 3 recorded')
  await expect(esign).not.toContainText('page.e_signature')

  await page.goto(`${base}/crm`, { waitUntil: 'domcontentloaded' })
  const crm = page.locator('[data-screen="crm-module"]')
  await expect(crm).toBeVisible({ timeout: 60_000 })
  await expect(crm).not.toContainText('page.crm_module')
})

test('in English the document detail panel keeps its labels', async ({ page }) => {
  await open(page, `/projects/${PROJECT}/clinical-writing`, { status: 'in-review' }, 'en')
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  const panel = page.locator('[data-panel="document-detail"]')
  await expect(panel).toContainText('Cross-Functional Review', { timeout: 30_000 })
  await expect(panel).toContainText('In Review')
  await expect(panel).toContainText('CSR (Full)')
})
