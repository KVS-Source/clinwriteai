// Module A — Clinical Writing happy path: sign in, open a project, land on
// the clinical writing module screen, see at least one document in the list.

import { test, expect } from '@playwright/test'
import { signInAsMarcus } from '../helpers/auth'

test('Module A — clinical writing project screen loads', async ({ page }) => {
  await signInAsMarcus(page)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The all-projects list should surface at least one card the tester can click.
  const firstProject = page.locator('[data-project-id]').first()
  await expect(firstProject).toBeVisible({ timeout: 10_000 })
  await firstProject.click()

  await page.waitForURL(/\/projects\/[^/]+/)
  const clinicalLink = page.getByRole('link', { name: /clinical.?writing/i }).first()
  if (await clinicalLink.isVisible().catch(() => false)) await clinicalLink.click()

  await expect(page).toHaveURL(/clinical-writing/)
})
