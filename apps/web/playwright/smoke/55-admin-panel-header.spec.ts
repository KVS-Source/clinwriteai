// QA regression — the Administrative Panel (and RACI Matrix, Notifications) names itself in the top bar (not "Projects") and has no
// "Platform > Administrative Panel > AI engine" breadcrumb above its heading, like Audit Trail.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/55-admin-panel-header.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ADMIN = { id: 'u-admin-e2e', email: 'admin@x.test', name: 'Admin E2E', role: 'tenant-admin', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

async function open(page: Page, language = 'en', path = '/admin') {
  await page.addInitScript(({ me, language }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    localStorage.setItem('clinwrite.demo.currentUserId', me.id)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      // The configuration isn't what's tested: refuse it, and the page shows its heading with a "try again".
      if (p.endsWith('/admin/config')) return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })
      if (p.endsWith('/subscription')) return json(null)
      return json([])
    }
  }, { me: ADMIN, language })
  await page.goto(path)
}

const header = (page: Page) => page.locator('header').first()
const screen = (page: Page) => page.locator('[data-screen="admin-panel"]')

test('the top bar says Administrative Panel, and the page has no breadcrumb', async ({ page }) => {
  await open(page)
  await expect(screen(page).locator('h1')).toHaveText('Administrative Panel', { timeout: 60_000 })
  await expect(header(page)).toContainText('Administrative Panel')
  await expect(header(page)).not.toContainText('Projects')
  await expect(screen(page).locator('nav')).toHaveCount(0)
  // The heading is the first thing on the page: nothing (no "Platform > …") above it.
  expect((await screen(page).innerText()).trimStart().startsWith('Administrative Panel')).toBe(true)
})

test('in Japanese the top bar uses the Japanese page title', async ({ page }) => {
  await open(page, 'ja')
  const h1 = screen(page).locator('h1')
  await expect(h1).toBeVisible({ timeout: 60_000 })
  await expect(header(page)).toContainText((await h1.textContent())!.trim())
})

test('RACI Matrix: the top bar says RACI Matrix (not Projects), and there is no "Platform > RACI Matrix" line', async ({ page }) => {
  await open(page, 'en', '/admin/raci')
  const raci = page.locator('[data-screen="raci-matrix"]')
  await expect(raci.locator('h1')).toBeVisible({ timeout: 60_000 })
  await expect(header(page)).toContainText('RACI Matrix')
  await expect(header(page)).not.toContainText('Projects')
  await expect(raci.locator('nav')).toHaveCount(0)
  expect((await raci.innerText()).trimStart().startsWith('RACI matrix')).toBe(true)
})

test('Notifications: the top bar says Notifications (not Projects), and there is no "Platform > Notifications" line', async ({ page }) => {
  await open(page, 'en', '/notifications')
  const centre = page.locator('[data-screen="notification-centre"]')
  await expect(centre.locator('h1')).toBeVisible({ timeout: 60_000 })
  await expect(header(page)).toContainText('Notifications')
  await expect(header(page)).not.toContainText('Projects')
  await expect(centre.locator('nav')).toHaveCount(0)
  expect((await centre.innerText()).trimStart().startsWith('Notifications')).toBe(true)
})

test('the top bar adds the open tab: "Administrative Panel / AI engine", then "/ eCTD" after switching', async ({ page }) => {
  await open(page)
  const crumbs = page.locator('header nav').first()
  await expect(crumbs).toHaveText(/^Administrative Panel\s*\/\s*AI engine$/, { timeout: 60_000 })
  await page.locator('[data-settings-tab="ectd"]').click()
  await expect(crumbs).toHaveText(/^Administrative Panel\s*\/\s*eCTD$/)
  await page.locator('[data-settings-tab="external-apis"]').click()
  await expect(crumbs).toHaveText(/^Administrative Panel\s*\/\s*External APIs$/)
})

test('the tab name goes when the page is left: Notifications shows no "/ eCTD"', async ({ page }) => {
  await open(page)
  await page.locator('[data-settings-tab="ectd"]').click({ timeout: 60_000 })
  await page.getByRole('link', { name: 'Notifications' }).first().click()
  const crumbs = page.locator('header nav').first()
  await expect(crumbs).toHaveText(/^Notifications$/, { timeout: 60_000 })
})
