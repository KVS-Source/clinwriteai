import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

test('Module D — regulatory writing screen loads', async ({ page }) => {
  await visitModule(page, 'regulatory-writing')
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
})
