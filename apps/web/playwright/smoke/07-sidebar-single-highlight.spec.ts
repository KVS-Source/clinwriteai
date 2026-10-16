// QA regression — only the selected sidebar item is highlighted.
//
// Defect: on /admin/users (and every other /admin/* page) the "Admin Panel"
// entry stayed highlighted too, because NavLink matches by path prefix.
//
//   E2E_BASE_URL=https://demo.clinwrite.ai npx playwright test playwright/smoke/07-sidebar-single-highlight.spec.ts

import { test, expect, type Page } from '@playwright/test'

// [route, the one platform link that must be active]
const CASES: Array<[string, string]> = [
  ['/admin', '/admin'],
  ['/admin/users', '/admin/users'],
  ['/admin/audit', '/admin/audit'],
  ['/admin/taxonomy', '/admin/taxonomy'],
  ['/admin/raci', '/admin/raci'],
  ['/library', '/library'],
  ['/library/best-practices', '/library/best-practices'],
  ['/notifications', '/notifications'],
]

async function activeLinks(page: Page) {
  return page.$$eval('[data-platform-link], [data-super-admin-link]', els =>
    els
      .filter(e => e.getAttribute('aria-current') === 'page')
      .map(e => e.getAttribute('data-platform-link') ?? e.getAttribute('data-super-admin-link')),
  )
}

for (const [route, expected] of CASES) {
  test(`${route} highlights only its own sidebar entry`, async ({ page }) => {
    await page.goto(route)
    await page.waitForSelector('[data-platform-link]', { timeout: 30_000 })
    await expect(page.locator(`[data-platform-link="${expected}"]`)).toHaveAttribute('aria-current', 'page')
    expect(await activeLinks(page)).toEqual([expected])
  })
}
