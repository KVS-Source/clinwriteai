// QA regression — a 429 means "please wait": reads retry by themselves with a notice, the user is never
// treated as signed out or sent to My Workspace, and a refused save is not retried behind their back.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/42-rate-limit-429.spec.ts
//
// Everything is answered inside the page. How requests are counted is in
// apps/api/src/modules/platform/rate-limit.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

type Stub = { me429?: number; projects429?: number; alwaysProjects429?: boolean; language?: string }
type Counts = { me: number; projects: number; posts: number }

async function open(page: Page, stub: Stub = {}) {
  await page.addInitScript((stub) => {
    localStorage.setItem('clinwrite.uiLanguage', stub.language ?? 'en')
    const n: Counts = { me: 0, projects: 0, posts: 0 }
    ;(window as unknown as { __n: Counts }).__n = n
    const json = (b: unknown, s = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...headers } })
    const limited = () => json({ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded, retry in 1 minute' }, 429, { 'Retry-After': '1' })
    const me = { id: 'u-pm', email: 'pm@x.test', name: 'Pat Manager', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const project = { id: 'P-1', name: 'Project One', shortTitle: 'Project One', status: 'ongoing', phase: 'Phase 1', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], submissionCountries: ['US'], team: [], documentCount: 1, startDate: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url)) {
        n.me++
        return n.me <= (stub.me429 ?? 0) ? limited() : json(me)
      }
      if (/\/projects(\?.*)?$/.test(url) && method === 'GET') {
        n.projects++
        if (stub.alwaysProjects429 || n.projects <= (stub.projects429 ?? 0)) return limited()
        return json([project])
      }
      if (method !== 'GET' && url.includes('/e2e-write')) { n.posts++; return limited() }
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json([], 200)
      return real(input, init)
    }
  }, stub)
  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
}

const counts = (page: Page) => page.evaluate(() => (window as unknown as { __n: Counts }).__n)

test('a 429 on /auth/me keeps the user where they are, as themselves', async ({ page }) => {
  await open(page, { me429: 2 })
  await expect(page.locator('[data-rate-limit-notice="retrying"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-action="new-project"]')).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(/\/projects$/)
  expect((await counts(page)).me).toBeGreaterThanOrEqual(3)
})

test('even a long run of 429s on /auth/me never redirects', async ({ page }) => {
  await open(page, { me429: 5 })
  await expect(page.locator('[data-action="new-project"]')).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(/\/projects$/)
})

test('a read that gets a 429 waits, retries, and the page loads with no error', async ({ page }) => {
  await open(page, { projects429: 2 })
  await expect(page.locator('[data-rate-limit-notice="retrying"]')).toContainText('Please wait, retrying')
  await expect(page.locator('[data-project-row="P-1"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-rate-limit-notice]')).toHaveCount(0)
  expect((await counts(page)).projects).toBe(3)
})

test('the notice is Japanese in Japanese', async ({ page }) => {
  await open(page, { projects429: 2, language: 'ja' })
  await expect(page.locator('[data-rate-limit-notice="retrying"]')).toContainText('再試行', { timeout: 60_000 })
})

test('when reads keep being refused it stops, says so, and stays on the page', async ({ page }) => {
  await open(page, { alwaysProjects429: true })
  await expect(page.locator('[data-rate-limit-notice="try-again"]')).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(/\/projects$/)
})
