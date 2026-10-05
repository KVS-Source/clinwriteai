import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

test('Module E — ideation screen loads', async ({ page }) => {
  // Prototype router mounts ideation under /ideation-publishing on project
  // routes, with /ideation also valid at project level — both land here.
  await visitModule(page, 'ideation')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
})
