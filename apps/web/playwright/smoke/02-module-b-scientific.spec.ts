import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

test('Module B — scientific writing screen loads', async ({ page }) => {
  await visitModule(page, 'scientific-writing')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
})
