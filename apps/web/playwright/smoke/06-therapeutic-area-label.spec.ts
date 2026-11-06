// QA regression — "Therapeutic Area" label consistency.
//
// Defect: Medical Writing's filter bar (below the search box) labelled the
// dropdown "Therapy area". It must read "Therapeutic Area" to match the PRD and
// the other modules.
//
// All Projects has no visible long label: its filter is a compact dropdown, "All TAs", named
// "Filter by TA" for screen readers (the column heading says "TA" too). So it is checked for that instead.
//
// Runs as a PM: a tenant admin is sent to My Workspace and never reaches these pages.
//
// Runs against any deployment:
//   E2E_BASE_URL=https://demo.clinwrite.ai E2E_PROJECT_ID=PROJ-TEST-ONCOLOGY \
//     npx playwright test playwright/smoke/06-therapeutic-area-label.spec.ts
// Optional: E2E_CHANNEL=msedge to use an installed Edge/Chrome.
// Medical Writing screens are skipped (not failed) when Module C is switched off
// on the target, since the label can't be on a screen that isn't mounted.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM = process.env.E2E_PM_PERSONA ?? 'user-sa'

// Pages are served by a remote API + database; a cold first load can take 20-50 s.
test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  await page.addInitScript((persona) => window.localStorage.setItem('clinwrite.demo.currentUserId', persona), PM)
})

async function open(page: Page, path: string) {
  await page.goto(path)
  // Wait for either real content (a filter dropdown) or the disabled-module screen.
  await Promise.race([
    page.waitForSelector('select', { timeout: 60_000 }),
    page.getByText(/temporarily disabled|not enabled/i).first().waitFor({ timeout: 60_000 }),
  ]).catch(() => undefined)
}

const moduleDisabled = (page: Page) => page.getByText(/temporarily disabled|not enabled/i).first().isVisible()

for (const [name, path] of [
  ['Medical Writing — home filter bar', `/projects/${PROJECT_ID}/medical-writing`],
  ['Medical Writing — portfolio filter bar', `/projects/${PROJECT_ID}/medical-writing/portfolio`],
] as const) {
  test(name, async ({ page }) => {
    await open(page, path)
    test.skip(await moduleDisabled(page), 'Module C is disabled on this deployment')

    // The label sits next to the TA dropdown, directly below the search bar.
    const label = page.locator('label', { hasText: /^Therapeutic Area/ }).filter({ has: page.locator('select') })
    await expect(label.first()).toBeVisible()
    await expect(page.getByText('Therapy area', { exact: false })).toHaveCount(0)
  })
}

test('Projects list filter is the compact TA dropdown', async ({ page }) => {
  await open(page, '/projects')
  const filter = page.locator('[data-ta-filter]')
  await expect(filter).toBeVisible()
  await expect(filter).toHaveAccessibleName('Filter by TA')
  await expect(filter.locator('option').first()).toHaveText('All TAs')
  await expect(page.locator('label', { hasText: /^Therapeutic Area/ })).toHaveCount(0)
  await expect(page.getByText('Therapy area', { exact: false })).toHaveCount(0)
})
