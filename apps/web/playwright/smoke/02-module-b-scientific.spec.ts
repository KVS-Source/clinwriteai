import { test, expect } from '@playwright/test'
import { signInAsMarcus } from '../helpers/auth'

test('Module B — scientific writing screen loads', async ({ page }) => {
  await signInAsMarcus(page)
  await page.goto('/projects')
  await page.locator('[data-project-id]').first().click()
  await page.waitForURL(/\/projects\/[^/]+/)

  const link = page.getByRole('link', { name: /scientific.?writing/i }).first()
  await link.click()
  await expect(page).toHaveURL(/scientific-writing/)
  await expect(page.getByRole('heading').first()).toBeVisible()
})
