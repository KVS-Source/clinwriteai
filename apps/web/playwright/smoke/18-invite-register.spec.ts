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
          ? { valid: true, email: 'ravi@acme.com', name: 'Ravi', role: 'tenant-admin', expiresAt: '2026-12-01T00:00:00Z' }
          : { valid: false, reason: 'expired' }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (/\/auth\/invitations\/register\b/.test(url) && method === 'POST') {
        (window as unknown as { __registerCalls: number }).__registerCalls++
        ;(window as unknown as { __registerBody: unknown }).__registerBody = JSON.parse(String(init?.body ?? '{}'))
        const status = registerStatus ?? 200
        const body = status === 200 ? { ok: true, email: 'ravi@acme.com' } : { error: 'password_policy', issues: [{ message: 'Must include a digit.' }] }
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      }
      return real(input, init)
    }
  }, opts)
}

test('a valid invite lets the user enter a name, set a password and register, then land on sign-in', async ({ page }) => {
  await mockInvite(page, { valid: true })
  await page.goto(`/accept-invitation?token=${TOKEN}`)

  await expect(page.locator('[data-invite-email]')).toHaveText('ravi@acme.com', { timeout: 30_000 })
  const submit = page.getByRole('button', { name: 'Create account' })
  await expect(submit).toBeDisabled()               // nothing entered yet

  await page.locator('#new-password').fill(STRONG)
  await page.locator('#confirm-password').fill(STRONG)
  await page.locator('[data-input="accept-terms"]').check()
  await expect(submit).toBeDisabled()               // name still missing — it is mandatory
  await page.locator('#invite-name').fill('   ')
  await expect(submit).toBeDisabled()               // blank name doesn't count
  await page.locator('#invite-name').fill('  Ravi Kumar ')
  await expect(submit).toBeEnabled()

  await submit.click()
  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 30_000 })
  await expect(page.locator('[data-screen="sign-in"]')).toBeVisible()
  await expect(page.getByText(/sign in with your email and new password/i)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __registerCalls: number }).__registerCalls)).toBe(1)
  const body = await page.evaluate(() => (window as unknown as { __registerBody: Record<string, unknown> }).__registerBody)
  expect(body).toMatchObject({ name: 'Ravi Kumar', newPassword: STRONG, acceptTerms: true })
  expect(body).not.toHaveProperty('tenantRef')       // optional Tenant ID left blank → nothing sent
})

test('name sits above email; email and role are read-only; Tenant ID is a plain, empty, optional input', async ({ page }) => {
  await mockInvite(page, { valid: true })
  await page.goto(`/accept-invitation?token=${TOKEN}`)
  await expect(page.locator('[data-invite-email]')).toBeVisible({ timeout: 30_000 })

  const nameBox  = (await page.locator('#invite-name').boundingBox())!
  const emailBox = (await page.locator('[data-invite-email]').boundingBox())!
  expect(nameBox.y).toBeLessThan(emailBox.y)

  await expect(page.locator('[data-invite-role]')).toHaveText('Tenant Admin')
  for (const sel of ['[data-invite-email]', '[data-invite-role]']) {
    expect(await page.locator(sel).evaluate(el => el.tagName)).toBe('DIV')   // read-only boxes, not inputs
  }

  const tenant = page.locator('#invite-tenant')
  await expect(tenant).toHaveValue('')                // nothing pre-filled
  await expect(tenant).toHaveAttribute('placeholder', 'Optional')
  await expect(tenant).toBeEditable()
  await expect(tenant).not.toHaveAttribute('required', '')
  await expect(page.locator('label[for="invite-tenant"]')).not.toContainText('*')

  for (const id of ['invite-name', 'new-password', 'confirm-password']) {
    await expect(page.locator(`label[for="${id}"]`)).toContainText('*')
    await expect(page.locator(`#${id}`)).toHaveAttribute('required', '')
  }
})

test('whatever the user types as Tenant ID is sent with the registration', async ({ page }) => {
  await mockInvite(page, { valid: true })
  await page.goto(`/accept-invitation?token=${TOKEN}`)
  await expect(page.locator('[data-invite-email]')).toBeVisible({ timeout: 30_000 })

  await page.locator('#invite-name').fill('Ravi Kumar')
  await page.locator('#invite-tenant').fill('  ACME / Mumbai-01 ')
  await page.locator('#new-password').fill(STRONG)
  await page.locator('#confirm-password').fill(STRONG)
  await page.locator('[data-input="accept-terms"]').check()
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { __registerBody: unknown }).__registerBody))
    .toMatchObject({ name: 'Ravi Kumar', tenantRef: 'ACME / Mumbai-01' })
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
