// QA regression — invite registration: the designated email user opens the invite link, sets a password,
// accepts the Terms, and registers. On success they land on /sign-in?registered=1 with a confirmation notice.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/18-invite-register.spec.ts
//
// The preview + register endpoints are answered inside the page; nothing is written to the database.

import { test, expect, type Page } from '@playwright/test'

const TOKEN = 'tok_' + 'a'.repeat(40)
const STRONG = 'Str0ng!Passw0rd'
test.setTimeout(120_000)

async function mockInvite(page: Page, opts: { valid: boolean; registerStatus?: number }) {
  await page.addInitScript(({ valid, registerStatus }) => {
    const real = window.fetch.bind(window)
    ;(window as unknown as { __registerCalls: number }).__registerCalls = 0
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/invitations\/preview\b/.test(url) && method === 'GET') {
        const body = valid
          ? { valid: true, email: 'ravi@acme.com', name: 'Ravi', role: 'contributor', expiresAt: '2026-12-01T00:00:00Z' }
          : { valid: false, reason: 'expired' }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (/\/auth\/invitations\/register\b/.test(url) && method === 'POST') {
        ;(window as unknown as { __registerCalls: number }).__registerCalls++
        const status = registerStatus ?? 200
        const body = status === 200 ? { ok: true, email: 'ravi@acme.com' } : { error: 'password_policy', issues: [{ message: 'Must include a digit.' }] }
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      }
      return real(input, init)
    }
  }, opts)
}

test('a valid invite lets the user set a password and register, then land on sign-in', async ({ page }) => {
  await mockInvite(page, { valid: true })
  await page.goto(`/accept-invitation?token=${TOKEN}`)

  await expect(page.locator('[data-invite-email]')).toHaveText('ravi@acme.com', { timeout: 30_000 })
  const submit = page.getByRole('button', { name: 'Create account' })
  await expect(submit).toBeDisabled()               // nothing entered yet

  await page.locator('#new-password').fill(STRONG)
  await page.locator('#confirm-password').fill(STRONG)
  await expect(submit).toBeDisabled()               // terms not yet accepted
  await page.locator('[data-input="accept-terms"]').check()
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 30_000 })
  await expect(page.locator('[data-screen="sign-in"]')).toBeVisible()
  await expect(page.getByText(/sign in with your email and new password/i)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __registerCalls: number }).__registerCalls)).toBe(1)
})

test('mismatched passwords block submit, and the confirm shows a mismatch hint', async ({ page }) => {
  await mockInvite(page, { valid: true })
  await page.goto(`/accept-invitation?token=${TOKEN}`)
  await expect(page.locator('[data-invite-email]')).toBeVisible({ timeout: 30_000 })

  await page.locator('#new-password').fill(STRONG)
  await page.locator('#confirm-password').fill(STRONG + 'x')
  await expect(page.locator('[data-password-mismatch]')).toBeVisible()
  await page.locator('[data-input="accept-terms"]').check()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
})

test('an expired invite shows a dead-end with a route back to sign-in', async ({ page }) => {
  await mockInvite(page, { valid: false })
  await page.goto(`/accept-invitation?token=${TOKEN}`)
  await expect(page.getByText(/expired/i)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#new-password')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /go to sign in/i })).toBeVisible()
})
