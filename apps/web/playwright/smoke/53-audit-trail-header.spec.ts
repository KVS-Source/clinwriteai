// QA regression — pages that are not project pages name themselves in the top bar: My Workspace, Audit Trail.
// The Audit Trail page also has a heading the same size as "Therapeutic area tags" on TA Tags.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/53-audit-trail-header.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'user-sa', email: 'pm@x.test', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

async function open(page: Page, path: string, language = 'en') {
  await page.addInitScript(({ me, language }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      if (/\/admin\/audit/.test(p)) return json({ rows: [], total: 0, nextCursor: null, prevCursor: null })
      return json([])
    }
  }, { me: PM, language })
  await page.goto(path)
}

const header = (page: Page) => page.locator('header').first()

test('the top bar says Audit Trail, and the page heading is as large as the TA Tags one', async ({ page }) => {
  await open(page, '/admin/audit')
  const title = page.locator('[data-audit-title]')
  await expect(title).toHaveText('Audit Trail', { timeout: 60_000 })
  await expect(header(page)).toContainText('Audit Trail')
  await expect(header(page)).not.toContainText('Projects')

  const auditSize = await title.evaluate(el => getComputedStyle(el).fontSize)
  await open(page, '/admin/taxonomy')
  const taTitle = page.locator('[data-screen="ta-tag-configuration"] h1')
  await expect(taTitle).toBeVisible({ timeout: 60_000 })
  expect(auditSize).toBe(await taTitle.evaluate(el => getComputedStyle(el).fontSize))
})

test('in Japanese both say 監査証跡', async ({ page }) => {
  await open(page, '/admin/audit', 'ja')
  await expect(page.locator('[data-audit-title]')).toHaveText('監査証跡', { timeout: 60_000 })
  await expect(header(page)).toContainText('監査証跡')
})

test('My Workspace says My Workspace in the top bar, not Projects', async ({ page }) => {
  await open(page, '/home')
  await expect(header(page)).toContainText('My Workspace', { timeout: 60_000 })
  await expect(header(page)).not.toContainText('Projects')
})

test('in Japanese the top bar on My Workspace says マイ ワークスペース', async ({ page }) => {
  await open(page, '/home', 'ja')
  await expect(header(page)).toContainText('マイ ワークスペース', { timeout: 60_000 })
})
