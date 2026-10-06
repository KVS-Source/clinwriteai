import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

// Module B is frozen under the 2026-10-06 pivot (docs/pivot-plan.md
// Arc 1). The route still mounts but the ModuleGate renders
// ModuleDisabledScreen. Smoke stays — we're testing that the frozen
// state renders a user-facing explanation instead of 404 or boot error.
test('Module B — scientific writing shows frozen-module screen', async ({ page }) => {
  await visitModule(page, 'scientific-writing')
  await expect(page.getByText(/temporarily disabled/i)).toBeVisible({ timeout: 10_000 })
})
