import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

test('Module C — medical writing screen loads', async ({ page }) => {
  await visitModule(page, 'medical-writing')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
})
