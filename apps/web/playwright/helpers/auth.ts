// Shared login + MFA helper for the smoke suite. Walks the mock auth flow
// (marcus.webb@genbiocat.com → 123456) and leaves the page on the projects
// landing route.

import type { Page } from '@playwright/test'

export async function signInAsMarcus(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill('marcus.webb@genbiocat.com')
  await page.getByLabel(/password/i).fill('password')
  await page.getByRole('button', { name: /sign in/i }).click()

  // MFA step — the mock accepts any 6-digit code.
  await page.waitForURL(/\/mfa$/)
  const codeInput = page.getByRole('textbox').first()
  await codeInput.fill('123456')
  await page.getByRole('button', { name: /verify|continue/i }).click()

  // Terms gate may intercept — accept if present.
  await page.waitForURL(/\/(terms|projects|$)/)
  if (await page.url().match(/\/terms$/)) {
    const accept = page.getByRole('button', { name: /accept|agree|continue/i })
    if (await accept.isVisible().catch(() => false)) await accept.click()
    await page.waitForURL(/\/(projects|$)/)
  }
}
