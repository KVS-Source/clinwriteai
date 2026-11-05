// QA regression — while a signature chain is in progress the document's RACI and checklist are fixed
// (docs/roles-and-permissions.md §4 "A fixed chain"). The RACI editor says so up front, disables adding
// and only offers Remove on your own assignment.
//
// The checklist lock has no browser test: a document awaiting signature opens on E-Signature (the Editor,
// where the checklist lives, is closed then). The panel's notice is for a writer who had the editor open
// when the chain started; the lock itself is covered by the API tests.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/34-chain-lock.spec.ts
//
// /auth/me, the project, its documents, the RACI rows / can-edit answer and the checklist are answered
// inside the page; nothing is written. Any other API call that comes back 401 is turned into a 503.
// The server rules are in apps/api (document-raci/chain-lock.test.ts, checklist/checklist-edit.test.ts).

import { test, expect, type Page } from '@playwright/test'

const PROJECT_ID = 'PROJ-E2E-CHAIN'
const DOC_ID = 'DOC-E2E-CHAIN'
test.setTimeout(120_000)

async function stub(page: Page, opts: { chainActive: boolean }) {
  await page.addInitScript(({ projectId, docId, chainActive }) => {
    const me = { id: 'u-me', email: 'me@example.com', name: 'Mia Member', role: 'contributor', capabilities: ['can-author'], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const doc = {
      id: docId, projectId, type: 'protocol', title: 'Protocol 7', status: 'pending-signature', stage: 'cross-functional-review', version: 'v0.4',
      therapeuticArea: 'Oncology', assigneeId: 'u-me', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Synopsis.</p>' }],
    }
    const raciRow = (id: string, userId: string, userName: string, letter: string) => ({
      id, documentId: docId, userId, userName, letter, sectionId: null, removedAt: null, rejectedAt: null, submittedAt: null,
      reviewedAt: null, approvedAt: null, signatureId: null, signatureRequired: false, signatureMeaning: null, approvalOrder: null,
    })
    const rows = [raciRow('raci-me', 'u-me', 'Mia Member', 'R'), raciRow('raci-rev', 'u-rev', 'Rory Reviewer', 'C'), raciRow('raci-app', 'u-app', 'Ada Approver', 'A')]
    const item = (id: string, text: string, status: string) => ({
      id, instanceId: 'inst', templateItemId: null, text, framework: 'ICH E6', frameworkMandatory: true, ownerRaci: 'R', stage: 'study_start_up',
      autoCompleteOn: null, status, isUserAdded: false, completedBy: status === 'complete' ? 'Mia Member' : null, completedAt: status === 'complete' ? '2026-11-01T09:00:00Z' : null,
      waivedBy: null, waivedAt: null, waiverReason: null, sortOrder: 0, canEdit: !chainActive, chainActive,
    })
    const checklist = [item('i1', 'Protocol synopsis reviewed', 'complete'), item('i2', 'Sample size justified', 'complete')]
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') return json([doc])
      if (new RegExp(`/projects/${projectId}(\\?.*)?$`).test(url) && method === 'GET') {
        return json({ id: projectId, name: 'Chain Test Project', shortTitle: 'Chain Test', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: null, team: [{ userId: 'u-me', name: 'Mia Member', initials: 'MM', role: 'Medical Writer' }], createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z' })
      }
      if (url.includes(`/projects/${projectId}/source-documents/access`)) return json({ canView: false, canUpload: false })
      if (url.includes(`/documents/${docId}/raci/can-edit`)) return json({ canEdit: true, chainActive })
      if (new RegExp(`/documents/${docId}/raci(\\?.*)?$`).test(url) && method === 'GET') return json(rows)
      if (url.includes(`/documents/${docId}/checklist/access`)) return json({ canView: true })
      if (new RegExp(`/documents/${docId}/checklist(\\?.*)?$`).test(url) && method === 'GET') return json(checklist)
      if (url.includes(`/documents/${docId}/stage`)) return json({ current: 'cross-functional-review', currentLabel: 'Cross-Functional Review', next: 'final-output', nextLabel: 'Final Output', terminal: false })
      if (url.includes(`/documents/${docId}/deadlines/access`)) return json({ canEditTarget: false, canEditReviewDue: false })
      if (url.includes(`/documents/${docId}/ai-draft-status`)) return json({ state: 'idle', confidenceOverall: null, sections: [], lastPassNumber: 0 })
      if (url.includes('/presence')) return json({ documentId: docId, sections: [] })
      if (new RegExp(`/documents/${docId}(\\?.*)?$`).test(url) && method === 'GET') return json(doc)
      if (url.includes(`/documents/${docId}/`)) return json(method === 'GET' ? [] : {})
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { projectId: PROJECT_ID, docId: DOC_ID, chainActive: opts.chainActive })
}

async function openRaci(page: Page, chainActive: boolean) {
  await stub(page, { chainActive })
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`, { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-doc-row="${DOC_ID}"]`).click({ timeout: 60_000 })
  await page.locator('[data-panel="document-detail"] [data-action="open-raci"]').click()
  await expect(page.locator('[data-raci-row="raci-rev"]')).toBeVisible({ timeout: 30_000 })
}

const row = (page: Page, id: string) => page.locator(`[data-raci-row="${id}"]`)

test('during a chain the RACI editor says why, cannot add anyone, and offers Remove only on your own row', async ({ page }) => {
  await openRaci(page, true)
  await expect(page.locator('[data-raci-chain-locked]')).toContainText('A signature chain is in progress')
  await expect(page.locator('[data-raci-chain-locked]')).toContainText('Cancel the chain')

  // Remove: your own assignment only
  await expect(row(page, 'raci-me').locator('[data-action="remove-raci"]')).toBeVisible()
  await expect(row(page, 'raci-rev').locator('[data-action="remove-raci"]')).toHaveCount(0)
  await expect(row(page, 'raci-app').locator('[data-action="remove-raci"]')).toHaveCount(0)

  // Adding: every picker is disabled
  const filters = page.getByLabel('Filter users')
  const count = await filters.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) await expect(filters.nth(i)).toBeDisabled()
})

test('without a chain the editor is as before: no notice, Remove on every row, pickers live', async ({ page }) => {
  await openRaci(page, false)
  await expect(page.locator('[data-raci-chain-locked]')).toHaveCount(0)
  for (const id of ['raci-me', 'raci-rev', 'raci-app']) await expect(row(page, id).locator('[data-action="remove-raci"]')).toBeVisible()
  await expect(page.getByLabel('Filter users').first()).toBeEnabled()
})
