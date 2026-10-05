// Boot smoke — the SPA must render without a runtime error. Also exercises
// the service worker registration path when MSW is enabled.

import { test, expect } from '@playwright/test'

test('app boots and renders the sign-in screen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', e => {
    if (e.type() === 'error') errors.push(e.text())
  })

  await page.goto('/')
  // Un-authenticated users are redirected to /sign-in by the shell.
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.locator('[data-screen="sign-in"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: /sign in to your account/i })).toBeVisible()

  // Allow MSW's own console lines but hard-fail on anything else.
  const nonMsw = errors.filter(e => !/mocking|service worker|\[MSW\]/i.test(e))
  expect(nonMsw, nonMsw.join('\n')).toEqual([])
})
