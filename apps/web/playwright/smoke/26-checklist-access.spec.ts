// QA regression — the checklist is for a PM, auditor, or the document's R, C, Q or A. Not Informed.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJ-X/DOC-ID \
//     npx playwright test playwright/smoke/26-checklist-access.spec.ts
//
// The access answer and the checklist are given inside the page (a real read can create a checklist on an
// older document), and presence pings are absorbed; nothing is written. The server rule is in the API tests.

import { test, expect, type Page } from '@playwright/test'

const DOC = process.env.E2E_DOC
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)
test.skip(!DOC, 'set E2E_DOC to PROJECT/DOCUMENT')

async function open(page: Page, canView: boolean) {
  const [projectId, documentId] = DOC!.split('/')
  await page.addInitScript(({ canView, persona, documentId }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const calls: string[] = []
    ;(window as unknown as { __checklistCalls: string[] }).__checklistCalls = calls
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/documents/${documentId}/checklist/access`)) return json({ canView })
      if (new RegExp(`/documents/${documentId}/checklist(\\?.*)?$`).test(url)) { calls.push(url); return json([]) }
      if (url.includes('/presence') && (init?.method ?? 'GET').toUpperCase() !== 'GET') return json({})
      return real(input, init)
    }
  }, { canView, persona: PM_PERSONA, documentId })
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-open-comments]')).toBeVisible({ timeout: 60_000 })
}

test('without access: no Checklist button, and the checklist is never asked for', async ({ page }) => {
  await open(page, false)
  await expect(page.locator('[data-action="toolbar-checklist"]')).toHaveCount(0, { timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { __checklistCalls: string[] }).__checklistCalls)).toEqual([])
})

test('with access: the Checklist button opens the panel', async ({ page }) => {
  await open(page, true)
  await page.locator('[data-action="toolbar-checklist"] button').click()
  await expect(page.locator('[data-panel-body="checklist-hub"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-checklist-not-allowed]')).toHaveCount(0)
})

test('the Editor toolbar follows the same answer', async ({ page }) => {
  await open(page, false)
  const [projectId, documentId] = DOC!.split('/')
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-version-trigger]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTitle('Checklist', { exact: true })).toHaveCount(0)
})

test('the Editor toolbar offers it to someone with access', async ({ page }) => {
  await open(page, true)
  const [projectId, documentId] = DOC!.split('/')
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTitle('Checklist', { exact: true })).toBeVisible({ timeout: 60_000 })
})
