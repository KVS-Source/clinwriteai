// Boot smoke — the SPA must render without a runtime error and the top-level
// shell must mount. The prototype currently has BYPASS_AUTH_IN_PROTOTYPE=true
// (see AuthGuard.tsx) so '/' lands on /projects directly; once that bypass
// is flipped off during Phase 2 cutover, this test still passes because the
// AllProjects shell is the authenticated landing route.

import { test, expect } from '@playwright/test'

test('app boots and renders the projects shell', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', e => {
    if (e.type() === 'error') errors.push(e.text())
  })

  await page.goto('/')
  // index route redirects to /projects
  await expect(page).toHaveURL(/\/projects(?:$|\?)/)
  await expect(page.getByRole('link', { name: /all projects/i })).toBeVisible({ timeout: 10_000 })

  // Allow MSW's own console noise; fail on anything else.
  const nonMsw = errors.filter(e => !/mocking|service worker|\[MSW\]/i.test(e))
  expect(nonMsw, nonMsw.join('\n')).toEqual([])
})
