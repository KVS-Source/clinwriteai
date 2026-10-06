import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

// Module E frozen — see 02-module-b-scientific.spec.ts for rationale.
// Route path is 'ideation-publishing' (an earlier version of this spec
// used 'ideation' which never matched the router).
test('Module E — ideation shows frozen-module screen', async ({ page }) => {
  await visitModule(page, 'ideation-publishing')
  await expect(page.getByText(/temporarily disabled/i)).toBeVisible({ timeout: 10_000 })
})
