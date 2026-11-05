// QA regression — pushing to the Master Library from the Clinical Writing document detail panel
// (FR-A-080 / AC-A-054): the Author (R) of a signed document pushes it, or one section, with the four
// mandatory tags (therapeutic area, module, document type, version) — the same push as on Final Document.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/33-detail-panel-library-push.spec.ts
//
// /auth/me, the project, its document list, the document, its RACI answer and the library calls are answered
// inside the page; nothing is written. Any other API call that comes back 401 (no real session in the test) is
// turned into a 503. The server rules (R only, signed only, TA must match) are in the API library tests.

import { test, expect, type Page } from '@playwright/test'

const PROJECT_ID = 'PROJ-E2E-PUSH'
const DOC_ID = 'DOC-E2E-PUSH'
test.setTimeout(120_000)

type Push = { documentId: string; sectionId?: string; taTag: string; module: string; docType: string; version: string }
type W = { __pushes: Push[] }

async function open(page: Page, opts: { status?: string; canEdit?: boolean; pushStatus?: number } = {}) {
  await page.addInitScript(({ projectId, docId, status, canEdit, pushStatus }) => {
    const w = window as unknown as W & { __entries: unknown[] }
    w.__pushes = []
    w.__entries = []
    const me = { id: 'u-me', email: 'me@example.com', name: 'Mia Member', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const doc = {
      id: docId, projectId, type: 'csr-full', title: 'CSR Study 101', status, stage: 'final-output', version: 'v1.0',
      therapeuticArea: 'Oncology', assigneeId: 'u-me', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z',
      sections: [
        { id: 's2', number: '§2', title: 'Synopsis', status: 'complete', contentHtml: '<p>Synopsis.</p>' },
        { id: 's11', number: '§11', title: 'Efficacy Evaluation', status: 'complete', contentHtml: '<p>Efficacy.</p>' },
      ],
    }
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') return json([doc])
      if (new RegExp(`/projects/${projectId}(\\?.*)?$`).test(url) && method === 'GET') {
        return json({ id: projectId, name: 'Push Test Project', shortTitle: 'Push Test', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: null, team: [{ userId: 'u-me', name: 'Mia Member', initials: 'MM', role: 'Medical Writer' }], createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z' })
      }
      if (url.includes(`/projects/${projectId}/source-documents/access`)) return json({ canView: false, canUpload: false })
      if (url.includes(`/library/by-document/${docId}`)) return json(w.__entries)
      if (/\/library\/push$/.test(url) && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Push
        w.__pushes.push(body)
        if (pushStatus) return json({ error: 'push_forbidden', message: 'Only the Author (R) of this document can push it to the Master Library.' }, pushStatus)
        w.__entries.push({ id: `lib-${w.__pushes.length}`, name: doc.title, sectionId: body.sectionId ?? null, documentVersion: doc.version, libraryVersion: 'v1.0' })
        return json({ id: `lib-${w.__pushes.length}` }, 201)
      }
      if (url.includes(`/documents/${docId}/raci/can-edit`)) return json({ canEdit })
      if (url.includes(`/documents/${docId}/stage`)) return json({ current: 'final-output', currentLabel: 'Final Output', next: null, nextLabel: null, terminal: true })
      if (url.includes(`/documents/${docId}/deadlines/access`)) return json({ canEditTarget: false, canEditReviewDue: false })
      if (new RegExp(`/documents/${docId}(\\?.*)?$`).test(url) && method === 'GET') return json(doc)
      if (url.includes(`/documents/${docId}/`)) return json([])
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { projectId: PROJECT_ID, docId: DOC_ID, status: opts.status ?? 'signed', canEdit: opts.canEdit ?? true, pushStatus: opts.pushStatus ?? 0 })
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`, { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-doc-row="${DOC_ID}"]`).click({ timeout: 60_000 })
  await expect(page.locator('[data-panel="document-detail"]')).toBeVisible()
}

const panel = (page: Page) => page.locator('[data-panel="document-detail"]')
const pushButton = (page: Page) => panel(page).locator('[data-action="push-to-library"]')
const pushes = (page: Page) => page.evaluate(() => (window as unknown as W).__pushes)

test('the Author of a signed document pushes the whole document with the four tags; the panel then says it is in the library', async ({ page }) => {
  await open(page)
  await expect(pushButton(page)).toBeVisible({ timeout: 30_000 })
  await pushButton(page).click()

  const form = page.locator('[data-push-panel]')
  await expect(form).toBeVisible()
  await expect(form.locator('[data-push-ta]')).toHaveText('Oncology')        // from the document, not editable
  await expect(form.locator('[data-push-version]')).toHaveText('v1.0')
  await expect(form.locator('[data-push-doctype]')).toHaveValue('CSR')      // a starting point from the document type
  await form.locator('[data-push-module]').selectOption('A')
  await form.locator('[data-action="confirm-push"]').click()

  await expect.poll(() => pushes(page)).toEqual([{ documentId: DOC_ID, taTag: 'Oncology', module: 'A', docType: 'CSR', version: 'v1.0' }])
  // the push panel closes, the detail panel stays, the button gives way to the badge
  await expect(form).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).locator('[data-library-badge]')).toHaveText('In Master Library')
  await expect(pushButton(page)).toHaveCount(0)
})

test('one section can be pushed on its own, tagged the same way', async ({ page }) => {
  await open(page)
  await pushButton(page).click({ timeout: 30_000 })
  const form = page.locator('[data-push-panel]')
  await form.getByLabel('One section').check()
  await expect(form.locator('[data-action="confirm-push"]')).toBeDisabled()   // no section chosen yet
  await expect(form.locator('[data-push-section] option')).toHaveText(['Choose a section', '§2 Synopsis', '§11 Efficacy Evaluation'])
  await form.locator('[data-push-section]').selectOption('s11')
  await form.locator('[data-push-module]').selectOption('D')
  await form.locator('[data-push-doctype]').selectOption('NDA')
  await form.locator('[data-action="confirm-push"]').click()

  await expect.poll(() => pushes(page)).toEqual([{ documentId: DOC_ID, sectionId: 's11', taTag: 'Oncology', module: 'D', docType: 'NDA', version: 'v1.0' }])
  await expect(panel(page).locator('[data-library-badge]')).toHaveText('1 section in Master Library')
  await expect(pushButton(page)).toBeVisible()      // the whole document can still go in
})

test('a document type is required', async ({ page }) => {
  await open(page)
  await pushButton(page).click({ timeout: 30_000 })
  const form = page.locator('[data-push-panel]')
  await form.locator('[data-push-doctype]').selectOption('')
  await expect(form.locator('[data-action="confirm-push"]')).toBeDisabled()
})

test('a refused push shows the reason and keeps the form open', async ({ page }) => {
  await open(page, { pushStatus: 403 })
  await pushButton(page).click({ timeout: 30_000 })
  const form = page.locator('[data-push-panel]')
  await form.locator('[data-action="confirm-push"]').click()
  await expect(form.getByRole('alert')).toContainText('Only the Author (R) of this document can push it to the Master Library.')
  await expect(form).toBeVisible()
})

test('no push for someone who is not the Author (R)', async ({ page }) => {
  await open(page, { canEdit: false })
  await expect(panel(page).locator('[data-action="open-document"]')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(pushButton(page)).toHaveCount(0)
})

test('no push for a document that is not signed', async ({ page }) => {
  await open(page, { status: 'pending-signature' })
  await expect(panel(page).locator('[data-action="open-document"]')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(pushButton(page)).toHaveCount(0)
})
