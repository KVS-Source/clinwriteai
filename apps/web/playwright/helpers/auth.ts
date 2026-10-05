// Shared navigation helpers for the smoke suite.
//
// Current prototype: BYPASS_AUTH_IN_PROTOTYPE=true in AuthGuard.tsx — '/'
// goes straight to /projects, and when there's one project the shell auto-
// forwards to /projects/:id. Once the auth bypass is removed in Phase 2 the
// helper will need to walk /sign-in; the branch below handles that fallback.
//
// We navigate to the module screen via URL rather than clicking cards because
// (1) the project cards don't carry a stable test selector today, and (2)
// URL-based navigation stays valid as the AllProjects layout evolves.

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const PROTOTYPE_PROJECT_ID = 'proj-velora-301'

async function ensureLoggedIn(page: Page) {
  if (!page.url().match(/\/sign-in$/)) return
  await page.getByLabel(/email/i).fill('marcus.webb@genbiocat.com')
  await page.getByLabel(/password/i).fill('password')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/mfa$/, { timeout: 10_000 })
  await page.getByRole('textbox').first().fill('123456')
  await page.getByRole('button', { name: /verify|continue/i }).click()
  await page.waitForURL(/\/(terms|projects)/, { timeout: 10_000 })
  if (page.url().match(/\/terms$/)) {
    await page.getByRole('button', { name: /accept|agree|continue/i }).click()
    await page.waitForURL(/\/projects/, { timeout: 10_000 })
  }
}

export async function visitModule(page: Page, modulePath: string) {
  await page.goto(`/projects/${PROTOTYPE_PROJECT_ID}/${modulePath}`)
  await ensureLoggedIn(page)
  await expect(page).toHaveURL(new RegExp(modulePath))
}
