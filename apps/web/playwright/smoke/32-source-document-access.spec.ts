// QA regression — who sees source documents on the Clinical Writing home and in the document editor.
// Upload shows for authors and PMs. R, C, Q, A, PM and Auditor see the Source Documents tab.
// Informed sees none of it, and no source calls are made for them.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/32-source-document-access.spec.ts
//
// The access answer, the documents and /auth/me are answered inside the page; nothing is written.
// The real server rules are in apps/api/src/modules/clinical-writing/documents/source-access.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-SRC'
const DOC = 'DOC-E2E-SRC'

async function setup(page: Page, access: { canView: boolean; canUpload: boolean }, role = 'contributor') {
  await page.addInitScript(({ project, doc, access, role }) => {
    const me = { id: 'u-e2e', email: 'e2e@example.com', name: 'E2E User', role, modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'CSR Full', status: 'in-authoring', stage: 'study-start-up',
      version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u-other', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'not-started', contentHtml: '<p>Draft text.</p>' }],
    }
    const calls: string[] = []
    ;(window as unknown as { __sourceCalls: string[] }).__sourceCalls = calls
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/projects/${project}/source-documents/access`)) return json(access)
      if (url.includes(`/projects/${project}/source-documents`) || url.includes(`/documents/${doc}/sources`) || url.includes(`/documents/${doc}/references`)) {
        calls.push(url)
        if (url.includes('/references')) return json({ projectId: project, items: [] })
        if (url.includes('/sources')) return json({ documentId: doc, items: [] })
        return json({ items: [], total: 0, page: 1, pageSize: 10, summary: { files: 2, saved: 2, rejected: 0 } })
      }
      if (new RegExp(`/projects/${project}/documents(\\?.*)?$`).test(url) && method === 'GET') return json([document])
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url) && method === 'GET') {
        return json({ id: project, name: 'E2E project', shortTitle: 'E2E', client: 'x', therapeuticArea: 'Oncology', phase: '1', status: 'ongoing', activeModules: ['A'], team: [] })
      }
      if (new RegExp(`/documents/${doc}/ai-draft-status`).test(url)) return json({ state: null, sections: [] })
      if (new RegExp(`/documents/${doc}/raci/can-edit`).test(url)) return json({ canEdit: false })
      if (new RegExp(`/documents/${doc}/raci(\\?.*)?$`).test(url)) return json([])
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, access, role })
}

const home = async (page: Page, path = '') => {
  await page.goto(`/projects/${PROJECT}/clinical-writing${path}`)
  await expect(page.locator(`[data-doc-row="${DOC}"]`).or(page.locator('[data-screen="source-documents"]'))).toBeVisible({ timeout: 60_000 })
}
const uploadButton = (page: Page) => page.locator('[data-action="upload-source"]')
const sourcesTab = (page: Page) => page.getByRole('button', { name: /^Source Documents/ })
const sourceCalls = (page: Page) => page.evaluate(() => (window as unknown as { __sourceCalls: string[] }).__sourceCalls)

test('an author or PM sees the tab and Upload', async ({ page }) => {
  await setup(page, { canView: true, canUpload: true })
  await home(page)
  await expect(uploadButton(page)).toBeVisible()
  await expect(sourcesTab(page)).toContainText('2')
  await sourcesTab(page).click()
  await expect(page.locator('[data-screen="source-documents"]')).toBeVisible()
})

test('a reviewer, QC, approver or auditor sees the tab but no Upload', async ({ page }) => {
  await setup(page, { canView: true, canUpload: false })
  await home(page)
  await expect(sourcesTab(page)).toBeVisible()
  await expect(uploadButton(page)).toHaveCount(0)
})

test('Informed sees no tab, no Upload, and no source calls are made', async ({ page }) => {
  await setup(page, { canView: false, canUpload: false })
  await home(page)
  await expect(sourcesTab(page)).toHaveCount(0)
  await expect(uploadButton(page)).toHaveCount(0)
  expect(await sourceCalls(page)).toEqual([])
})

test('Informed following a saved link to the tab lands on the documents list', async ({ page }) => {
  await setup(page, { canView: false, canUpload: false })
  await home(page, '?tab=sources')
  await expect(page.locator('[data-screen="source-documents"]')).toHaveCount(0)
  await expect(page.locator(`[data-doc-row="${DOC}"]`)).toBeVisible()
})

test('Informed: the document panel has no source section', async ({ page }) => {
  await setup(page, { canView: false, canUpload: false })
  await home(page)
  await page.locator(`[data-doc-row="${DOC}"]`).click()
  await expect(page.locator('[data-panel="document-detail"]')).toBeVisible()
  await expect(page.locator('[data-panel="document-detail"]')).not.toContainText('Source Documents')
  expect(await sourceCalls(page)).toEqual([])
})

test('a reviewer: the document panel lists sources', async ({ page }) => {
  await setup(page, { canView: true, canUpload: false })
  await home(page)
  await page.locator(`[data-doc-row="${DOC}"]`).click()
  await expect(page.locator('[data-empty-sources]')).toBeVisible()
})

const openEditor = async (page: Page) => {
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}`)
  await expect(page.locator('[data-screen="document-editor"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-reference-toggle]').click()
}

test('Informed in the editor: Source References is not offered, and references are not fetched', async ({ page }) => {
  await setup(page, { canView: false, canUpload: false })
  await openEditor(page)
  await expect(page.locator('[data-reference-menu]')).toBeVisible()
  await expect(page.locator('[data-reference-option="traceability"]')).toHaveCount(0)
  expect(await sourceCalls(page)).toEqual([])
})

test('a reviewer in the editor: Source References opens', async ({ page }) => {
  await setup(page, { canView: true, canUpload: false })
  await openEditor(page)
  await page.locator('[data-reference-option="traceability"]').click()
  await expect(page.locator('[data-panel="source-references"]')).toBeVisible()
})
