// QA regression — only a document's R, C, Q or A gets the comment box and the Approve / Return verdicts.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJ-X/DOC-ID \
//     npx playwright test playwright/smoke/24-comment-add-access.spec.ts
//
// The access answer is given inside the page, and presence pings (which write audit rows) are absorbed;
// nothing is written. The real server rule is covered by the API tests.

import { test, expect, type Page } from '@playwright/test'

const DOC = process.env.E2E_DOC
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)

async function open(page: Page, canAdd: boolean) {
  const [projectId, documentId] = DOC!.split('/')
  await page.addInitScript(({ canAdd, persona, documentId }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/documents/${documentId}/comments/access`)) return json({ canAdd })
      if (url.includes('/presence') && (init?.method ?? 'GET').toUpperCase() !== 'GET') return json({})
      return real(input, init)
    }
  }, { canAdd, persona: PM_PERSONA, documentId })
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-open-comments]')).toBeVisible({ timeout: 60_000 })
}

test.skip(!DOC, 'set E2E_DOC to PROJECT/DOCUMENT')

test('without access: a note, no composer, no verdicts, no Add or Flag', async ({ page }) => {
  await open(page, false)
  await expect(page.locator('[data-comment-not-allowed]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-comment-composer]')).toHaveCount(0)
  await expect(page.locator('[data-open-composer]')).toHaveCount(0)
  await expect(page.locator('[data-action="approve-section"]')).toHaveCount(0)
  await expect(page.locator('[data-action="return-for-revision"]')).toHaveCount(0)
  await expect(page.locator('[data-action="toolbar-add-comment"]')).toHaveCount(0)
  await expect(page.locator('[data-action="toolbar-flag-section"]')).toHaveCount(0)

  // Reading the comments stays open.
  await page.locator('[data-open-comments]').click()
  await expect(page.locator('[data-action="add-comment"]')).toHaveCount(0)
})

test('with access: the composer, verdicts, Add and Flag are all there', async ({ page }) => {
  await open(page, true)
  await expect(page.locator('[data-comment-composer]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-comment-not-allowed]')).toHaveCount(0)
  await expect(page.locator('[data-action="approve-section"]')).toBeVisible()
  await expect(page.locator('[data-action="return-for-revision"]')).toBeVisible()
  await expect(page.locator('[data-action="toolbar-add-comment"]')).toBeVisible()
  await expect(page.locator('[data-action="toolbar-flag-section"]')).toBeVisible()
})
