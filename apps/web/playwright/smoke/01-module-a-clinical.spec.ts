import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

test('Module A — clinical writing screen loads', async ({ page }) => {
  await visitModule(page, 'clinical-writing')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
})
