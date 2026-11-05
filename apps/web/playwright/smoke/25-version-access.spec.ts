// QA regression — Version Diff and the version list are for a PM, auditor, or the document's R or Q.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJ-X/DOC-ID \
//     npx playwright test playwright/smoke/25-version-access.spec.ts
//
// The access answer and version list are given inside the page, and presence pings (which write audit
// rows) are absorbed; nothing is written. The real server rule is covered by the API tests.

import { test, expect, type Page } from '@playwright/test'

const DOC = process.env.E2E_DOC
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)
test.skip(!DOC, 'set E2E_DOC to PROJECT/DOCUMENT')

const VERSIONS = [
  { id: 'v2', versionNumber: 'v0.2', label: 'Draft', isCurrent: true,  createdBy: 'u', createdAt: '2026-11-02T00:00:00Z', contentHash: 'b' },
  { id: 'v1', versionNumber: 'v0.1', label: 'Draft', isCurrent: false, createdBy: 'u', createdAt: '2026-11-01T00:00:00Z', contentHash: 'a' },
]

function stub(page: Page, canView: boolean) {
  const documentId = DOC!.split('/')[1]
  return page.addInitScript(({ canView, persona, documentId, versions }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const seen: string[] = []
    ;(window as unknown as { __versionCalls: string[] }).__versionCalls = seen
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/documents/${documentId}/versions/access`)) return json({ canView })
      if (new RegExp(`/documents/${documentId}/versions(\\?.*)?$`).test(url)) { seen.push(url); return json(versions) }
      if (url.includes('/presence') && (init?.method ?? 'GET').toUpperCase() !== 'GET') return json({})
      return real(input, init)
    }
  }, { canView, persona: PM_PERSONA, documentId, versions: VERSIONS })
}

const base = () => {
  const [projectId, documentId] = DOC!.split('/')
  return `/projects/${projectId}/clinical-writing/documents/${documentId}`
}
const tab = (page: Page) => page.getByRole('link', { name: 'Version Diff' })

test('without access: no tab, no version menu, and the version list is never asked for', async ({ page }) => {
  await stub(page, false)
  await page.goto(base(), { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-version-trigger]')).toBeDisabled({ timeout: 60_000 })
  await expect(tab(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Reviewer View' })).toBeVisible()
  await page.locator('[data-version-trigger]').click({ force: true })
  await expect(page.locator('[data-version-menu]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __versionCalls: string[] }).__versionCalls)).toEqual([])
})

test('without access: a deep link to Version Diff lands on the document', async ({ page }) => {
  await stub(page, false)
  await page.goto(`${base()}/diff`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-version-trigger]')).toBeVisible({ timeout: 60_000 })
  await expect(page).not.toHaveURL(/\/diff$/)
})

test('with access: the tab and version menu are there', async ({ page }) => {
  await stub(page, true)
  await page.goto(base(), { waitUntil: 'domcontentloaded' })
  await expect(tab(page)).toBeVisible({ timeout: 60_000 })
  // The tab bar draws before the Editor below it has finished loading.
  await expect(page.locator('[data-version-trigger]')).toBeEnabled({ timeout: 60_000 })
  await page.locator('[data-version-trigger]').click()
  await expect(page.locator('[data-version-option="v0.1"]')).toBeVisible()
})
