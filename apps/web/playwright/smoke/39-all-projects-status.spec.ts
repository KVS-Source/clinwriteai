// QA regression — All Projects: the status filter offers every status, and the Status column shows each
// project's own status, translated.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/39-all-projects-status.spec.ts
//
// The project list is answered inside the page; nothing is written.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const STATUSES = ['initiated', 'ongoing', 'on-hold', 're-open', 'closed']

async function open(page: Page, language = 'en') {
  await page.addInitScript(({ statuses, language }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const me = { id: 'user-sa', email: 'pm@x.test', name: 'Pat Manager', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const projects = statuses.map(status => ({
      id: `P-${status}`, name: `Project ${status}`, shortTitle: `Project ${status}`, status, phase: 'Phase 1', therapeuticArea: 'Oncology', tenantId: null,
      activeModules: ['A'], submissionCountries: ['US'], team: [], documentCount: 1, startDate: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
    }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (/\/projects(\?.*)?$/.test(url)) return json(projects)
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json([], 200)
      return real(input, init)
    }
  }, { statuses: STATUSES, language })
  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-project-row]').first()).toBeVisible({ timeout: 60_000 })
}

const rows = (page: Page) => page.locator('[data-project-row]')

test('the filter has a chip for every status, including Closed', async ({ page }) => {
  await open(page)
  for (const [value, label] of [['all', 'All'], ['ongoing', 'Ongoing'], ['initiated', 'Initiated'], ['on-hold', 'On hold'], ['re-open', 'Re-open'], ['closed', 'Closed']]) {
    await expect(page.locator(`[data-status-filter="${value}"]`)).toHaveText(label!)
  }
})

for (const status of STATUSES) {
  test(`filtering by ${status} shows only that project`, async ({ page }) => {
    await open(page)
    await page.locator(`[data-status-filter="${status}"]`).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(page.locator(`[data-project-row="P-${status}"]`)).toBeVisible()
    await page.locator('[data-status-filter="all"]').click()
    await expect(rows(page)).toHaveCount(STATUSES.length)
  })
}

test('the Status column shows each project its own status', async ({ page }) => {
  await open(page)
  const expected: Record<string, string> = { initiated: 'Initiated', ongoing: 'Ongoing', 'on-hold': 'On hold', 're-open': 'Re-open', closed: 'Closed' }
  for (const [status, label] of Object.entries(expected)) {
    await expect(page.locator(`[data-project-row="P-${status}"] [data-project-status="${status}"]`)).toHaveText(label)
  }
})

test('the filter and the Status column are Japanese in Japanese', async ({ page }) => {
  await open(page, 'ja')
  await expect(page.locator('[data-status-filter="closed"]')).toHaveText('完了')
  await expect(page.locator('[data-project-row="P-closed"] [data-project-status="closed"]')).toHaveText('完了')
  await expect(page.locator('[data-project-row="P-ongoing"] [data-project-status="ongoing"]')).toHaveText('進行中')
})
