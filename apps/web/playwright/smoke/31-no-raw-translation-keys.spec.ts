// QA regression — screens show words, never translation keys such as page.role_home.jump_to.
// Twelve screens' text once sat under the wrong group in en.json and ja.json, and every label
// rendered as its key.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/31-no-raw-translation-keys.spec.ts
//
// Writes are refused inside the browser, so visiting these screens changes nothing.

import { test, expect, type Page } from '@playwright/test'

const ADMIN = process.env.E2E_ADMIN_PERSONA ?? 'user-admin'
const RAW_KEY = /\b(?:page|component)\.[a-z_]+\.[a-z0-9_]+/g
test.setTimeout(120_000)

const SCREENS = [
  { path: '/home', section: 'quick-links' },
  { path: '/admin/raci' },
  { path: '/admin/checklist-templates' },
  { path: '/admin/frameworks' },
  { path: '/notifications' },
  { path: '/library' },
  { path: '/library/best-practices' },
  { path: '/services' },
  { path: '/reports' },
]

async function visitAsAdmin(page: Page, path: string) {
  await page.addInitScript((persona) => window.localStorage.setItem('clinwrite.demo.currentUserId', persona), ADMIN)
  await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort())
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
}

for (const { path } of SCREENS) {
  test(`${path} shows no translation keys`, async ({ page }) => {
    await visitAsAdmin(page, path)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.locator('main, [data-screen]').first()).toBeVisible({ timeout: 60_000 })
    const text = await page.locator('body').innerText()
    expect(text.match(RAW_KEY) ?? []).toEqual([])
  })
}

test('the admin home shows its text, and quick links stay inside their cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await visitAsAdmin(page, '/home')
  await expect(page.locator('[data-screen="role-home"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-section="can"]')).toContainText('What you can do')
  await expect(page.locator('[data-section="cannot"]')).toContainText('What is restricted')

  const links = page.locator('[data-section="quick-links"] [data-quick-link]')
  await expect(links.filter({ hasText: 'User management' })).toBeVisible()
  await expect(links.filter({ hasText: 'Admin panel' })).toBeVisible()

  const overflowing = await links.evaluateAll(cards => cards
    .filter(c => c.scrollWidth > c.clientWidth)
    .map(c => c.textContent))
  expect(overflowing).toEqual([])
})
