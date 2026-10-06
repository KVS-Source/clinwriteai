import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

// Module C frozen — see 02-module-b-scientific.spec.ts for rationale.
test('Module C — medical writing shows frozen-module screen', async ({ page }) => {
  await visitModule(page, 'medical-writing')
  await expect(page.getByText(/temporarily disabled/i)).toBeVisible({ timeout: 10_000 })
})
