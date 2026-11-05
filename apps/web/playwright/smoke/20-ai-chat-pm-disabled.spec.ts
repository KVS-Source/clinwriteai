// QA regression — AI Chat is only for a document's authors. For everyone else the toolbar button
// is disabled (with an explaining tooltip), ⌘J / Ctrl+J does nothing, and the panel and the inline
// section AI prompt don't appear. An author still gets AI Chat, including while the document is in review.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/20-ai-chat-pm-disabled.spec.ts
//
// /auth/me, the document and the author check are answered inside the page; nothing is written. Any other
// API call that comes back 401 (no real session in the test) is turned into a 503 so the page isn't
// redirected to /sign-in. The API refuses AI calls from non-authors as well — covered by edit-gate.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-AI'
const DOC = 'DOC-E2E-AI'
const AUTHORS_ONLY = "AI Chat is only available to this document's authors"

async function openEditorAs(page: Page, role: 'pm' | 'contributor' | 'auditor', opts: { canEdit: boolean; status?: string }) {
  await page.addInitScript(({ role, project, doc, canEdit, status }) => {
    const me = { id: `u-${role}`, email: `${role}@example.com`, name: role === 'pm' ? 'Pat Manager' : 'Cora Writer', role,
      modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'CSR Full', status, stage: 'study-start-up',
      version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u-author', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's-11-4', number: '11.4', title: 'Primary Efficacy Analysis', status: 'not-started', contentHtml: '<p>Draft text.</p>' }],
    }
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit })
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { role, project: PROJECT, doc: DOC, canEdit: opts.canEdit, status: opts.status ?? 'in-authoring' })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}`)
  await expect(page.locator('[data-screen="document-editor"]')).toBeVisible({ timeout: 60_000 })
}

const aiButton = (page: Page) => page.locator('[data-action="toggle-ai-chat"]')
const aiPanel  = (page: Page) => page.locator('[data-panel="ai-chat"]')

for (const [label, role] of [
  ['A reviewer, QC, approver or Informed', 'contributor'],
  ['A Project Manager', 'pm'],
  // A tenant admin never reaches the editor (the router sends them home); edit-gate.test.ts covers the API.
  ['An auditor', 'auditor'],
] as const) {
  test(`${label}: the AI Chat button is disabled with the reason, and nothing opens it`, async ({ page }) => {
    await openEditorAs(page, role, { canEdit: false })
    await expect(aiButton(page)).toBeDisabled()
    await expect(aiButton(page)).toHaveAttribute('title', AUTHORS_ONLY)
    await aiButton(page).click({ force: true })
    await page.keyboard.press('Control+KeyJ')
    await page.keyboard.press('Meta+KeyJ')
    await expect(aiPanel(page)).toHaveCount(0)
    await expect(page.locator('[data-section-ai-prompt-dock]')).toHaveCount(0)
  })
}

test('A reviewer on a document in review: AI Chat is disabled', async ({ page }) => {
  await openEditorAs(page, 'contributor', { canEdit: false, status: 'in-review' })
  await expect(aiButton(page)).toBeDisabled()
  await expect(aiPanel(page)).toHaveCount(0)
})

test('An author: the button opens the panel, and ⌘J / Ctrl+J toggles it', async ({ page }) => {
  await openEditorAs(page, 'contributor', { canEdit: true })
  await expect(aiButton(page)).toBeEnabled()
  await expect(aiButton(page)).toHaveAttribute('title', 'Open AI Chat (⌘J)')
  await aiButton(page).dispatchEvent('click')
  await expect(aiPanel(page)).toBeVisible()
  await page.keyboard.press('Control+KeyJ')
  await expect(aiPanel(page)).toHaveCount(0)
  await page.keyboard.press('Control+KeyJ')
  await expect(aiPanel(page)).toBeVisible()
})

test('An author on a document in review: the panel opens, with the prompt read-only', async ({ page }) => {
  await openEditorAs(page, 'contributor', { canEdit: true, status: 'in-review' })
  await aiButton(page).dispatchEvent('click')
  await expect(aiPanel(page)).toBeVisible()
  await expect(page.locator('[data-ai-chat-input]')).toBeDisabled()
  await expect(page.locator('[data-ai-chat-send]')).toBeDisabled()
})
