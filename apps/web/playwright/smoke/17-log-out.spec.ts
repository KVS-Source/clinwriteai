// QA regression — "Log out" in the top-bar persona panel: calls POST /auth/logout, forgets the demo persona,
// and lands on /sign-in. Logs out locally even when the logout call fails.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/17-log-out.spec.ts
//
// /auth/logout is answered inside the page; no real session is revoked.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PERSONA_KEY = 'clinwrite.demo.currentUserId'
test.setTimeout(120_000)

async function stubLogout(page: Page, status: number) {
  await page.addInitScript(({ status, key }) => {
    // Seed a persona only on the first load, so the post-logout page shows whether it was cleared.
    if (!sessionStorage.getItem('e2e.seeded')) {
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.setItem(key, 'user-admin')
      localStorage.setItem(key, 'user-admin')
    }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/auth\/logout$/.test(url) && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        sessionStorage.setItem('e2e.logoutCalls', String(Number(sessionStorage.getItem('e2e.logoutCalls') ?? 0) + 1))
        return new Response(status === 200 ? '{"ok":true}' : '{"error":"unauthorized"}', { status, headers: { 'Content-Type': 'application/json' } })
      }
      return real(input, init)
    }
  }, { status, key: PERSONA_KEY })
}

async function logOutFromPanel(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.locator('[data-persona-trigger]').click()
  const button = page.locator('[data-persona-menu] [data-action="log-out"]')
  await expect(button).toHaveText('Log out')
  await button.dispatchEvent('click')
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 30_000 })
  await expect(page.locator('[data-screen="sign-in"]')).toBeVisible({ timeout: 30_000 })   // full page load on the dev server
}

test('Log out is fully on-screen and not covered, even in a short window with a long persona list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 })
  await stubLogout(page, 200)
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.locator('[data-persona-trigger]').click()
  const menu = page.locator('[data-persona-menu]')
  const button = menu.locator('[data-action="log-out"]')
  await expect(button).toBeVisible()

  // the panel fits the window, and the button lies inside it
  const vh = page.viewportSize()!.height
  const panel = (await menu.boundingBox())!
  const box = (await button.boundingBox())!
  expect(panel.y + panel.height).toBeLessThanOrEqual(vh)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(vh)

  // nothing sits on top of it (e.g. the dev MSW badge): the topmost element at its centre is the button
  const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-action="log-out"]'),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  expect(onTop).toBe(true)
})

for (const [label, status] of [['succeeds', 200], ['fails (no session)', 401]] as const) {
  test(`Log out lands on sign-in and clears the persona when the logout call ${label}`, async ({ page }) => {
    await stubLogout(page, status)
    await logOutFromPanel(page)
    expect(await page.evaluate(() => sessionStorage.getItem('e2e.logoutCalls'))).toBe('1')
    expect(await page.evaluate(k => [sessionStorage.getItem(k), localStorage.getItem(k)], PERSONA_KEY)).toEqual([null, null])
  })
}
