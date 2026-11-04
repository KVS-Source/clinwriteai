// QA regression — AI Chat is turned off for Project Managers in the document editor:
// the toolbar button is disabled (with an explaining tooltip), ⌘J / Ctrl+J does nothing, and the
// inline section AI prompt is hidden. A contributor still gets AI Chat.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/20-ai-chat-pm-disabled.spec.ts
//
// /auth/me and the document are answered inside the page; nothing is written. Any other API call that
// comes back 401 (no real session in the test) is turned into a 503 so the page isn't redirected to /sign-in.
// The API refuses AI calls from a PM as well (ai_chat_not_allowed) — covered by edit-gate.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-AI'
const DOC = 'DOC-E2E-AI'

async function openEditorAs(page: Page, role: 'pm' | 'contributor', opts: { canEdit?: boolean } = {}) {
  await page.addInitScript(({ role, project, doc, canEdit }) => {
    const me = { id: `u-${role}`, email: `${role}@example.com`, name: role === 'pm' ? 'Pat Manager' : 'Cora Writer', role,
      modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'CSR Full', status: 'in-authoring', stage: 'study-start-up',
      version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: `u-${role}`, updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's-11-4', number: '11.4', title: 'Primary Efficacy Analysis', status: 'not-started', contentHtml: '<p>Draft text.</p>' }],
    }
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      // Editing rights (an active R row or the assignee); undefined = leave it to the real API.
      if (canEdit !== undefined && url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit })
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { role, project: PROJECT, doc: DOC, canEdit: opts.canEdit })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}`)
  await expect(page.locator('[data-screen="document-editor"]')).toBeVisible({ timeout: 60_000 })
}

const aiButton = (page: Page) => page.locator('[data-action="toggle-ai-chat"]')
const aiPanel  = (page: Page) => page.locator('[data-panel="ai-chat"]')

test('Project Manager: the AI Chat button is disabled with an explaining tooltip, and clicking does nothing', async ({ page }) => {
  await openEditorAs(page, 'pm')
  await expect(aiButton(page)).toBeDisabled()
  await expect(aiButton(page)).toHaveAttribute('title', "AI Chat isn't available to Project Managers")
  await aiButton(page).click({ force: true })
  await expect(aiPanel(page)).toHaveCount(0)
})

test('Project Manager: ⌘J / Ctrl+J does not open AI Chat, and the inline section AI prompt is hidden', async ({ page }) => {
  await openEditorAs(page, 'pm')
  await page.keyboard.press('Control+KeyJ')
  await page.keyboard.press('Meta+KeyJ')
  await expect(aiPanel(page)).toHaveCount(0)
  await expect(page.locator('[data-section-ai-prompt-dock]')).toHaveCount(0)
})

test('Contributor: AI Chat stays available — the button opens the panel', async ({ page }) => {
  await openEditorAs(page, 'contributor')
  await expect(aiButton(page)).toBeEnabled()
  await expect(aiButton(page)).toHaveAttribute('title', 'Open AI Chat (⌘J)')
  await aiButton(page).dispatchEvent('click')
  await expect(aiPanel(page)).toBeVisible()
})

test('Reviewer (not an author): AI Chat opens read-only — the prompt box and Send are disabled with the reason', async ({ page }) => {
  await openEditorAs(page, 'contributor', { canEdit: false })
  await aiButton(page).dispatchEvent('click')
  await expect(aiPanel(page)).toBeVisible()
  const input = page.locator('[data-ai-chat-input]')
  await expect(input).toBeDisabled()
  await expect(input).not.toHaveAttribute('placeholder', 'Ask about this section, or request a rewrite…')
  await expect(page.locator('[data-ai-chat-send]')).toBeDisabled()
})
