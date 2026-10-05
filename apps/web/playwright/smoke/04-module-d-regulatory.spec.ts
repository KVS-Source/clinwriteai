import { test, expect } from '@playwright/test'
import { signInAsMarcus } from '../helpers/auth'

test('Module D — regulatory writing screen loads', async ({ page }) => {
  await signInAsMarcus(page)
  await page.goto('/projects')
  await page.locator('[data-project-id]').first().click()
  await page.waitForURL(/\/projects\/[^/]+/)

  const link = page.getByRole('link', { name: /regulatory.?writing/i }).first()
  await link.click()
  await expect(page).toHaveURL(/regulatory-writing/)
  await expect(page.getByRole('heading').first()).toBeVisible()
})
