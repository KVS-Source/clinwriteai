// QA regression — "Therapeutic Area" label consistency.
//
// Defect: Medical Writing's filter bar (below the search box) labelled the
// dropdown "Therapy area". It must read "Therapeutic Area" to match the PRD and
// the other modules.
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

// Pages are served by a remote API + database; a cold first load can take 20-50 s.
test.setTimeout(120_000)

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

test('Projects list filter uses the same label', async ({ page }) => {
  await open(page, '/projects')
  const label = page.locator('label', { hasText: /^Therapeutic Area/ }).filter({ has: page.locator('select') })
  await expect(label.first()).toBeVisible()
  await expect(page.getByText('Therapy area', { exact: false })).toHaveCount(0)
})
