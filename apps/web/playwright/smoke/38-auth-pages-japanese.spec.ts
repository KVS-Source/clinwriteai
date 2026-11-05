// QA regression — with the language set to Japanese, the sign-in, forgot-password, reset-password and
// accept-invitation pages show no English, including the API's refusals (which it sends in English).
// In English the same refusals read as they always did.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/38-auth-pages-japanese.spec.ts
//
// Everything is answered inside the page, so no login, email or account is attempted.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const TOKEN = 'tok_' + 'a'.repeat(40)

type Stub = {
  language?: string
  login?: { status: number; body: unknown }
  register?: { status: number; body: unknown }
  reset?: { status: number; body: unknown }
  invite?: unknown
}

async function open(page: Page, path: string, stub: Stub = {}) {
  await page.addInitScript((stub) => {
    localStorage.setItem('clinwrite.uiLanguage', stub.language ?? 'ja')
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/auth/password-login')) return json(stub.login?.body ?? {}, stub.login?.status ?? 200)
      if (url.includes('/auth/forgot-password')) return json({ ok: true, message: 'If an account exists for a@b.co, a password reset link has been sent. The link expires in 30 minutes.', expiresInMinutes: 30 })
      if (url.includes('/auth/reset-password')) return json(stub.reset?.body ?? {}, stub.reset?.status ?? 200)
      if (url.includes('/auth/invitations/preview')) return json(stub.invite ?? { valid: true, email: 'boss@company.com', name: 'The Boss', role: 'pm', expiresAt: '2026-12-01T00:00:00Z' })
      if (url.includes('/auth/invitations/register')) return json(stub.register?.body ?? { ok: true }, stub.register?.status ?? 200)
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json({ error: 'e2e_no_api' }, 401)
      return real(input, init)
    }
  }, stub)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
}

// English words on the card, apart from the test data and terms kept in English in the Japanese text.
const ALLOWED = /^(CFR|Part|AI|ClinWrite|ID|Clin|Write|MSW)$/
async function expectNoEnglish(page: Page, screen: string) {
  const card = page.locator(`[data-screen="${screen}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  let text = await card.evaluate(n => (n as HTMLElement).innerText)
  text += '\n' + await card.evaluate(n => [...n.querySelectorAll('[placeholder],[title],[aria-label]')].map(e => ['placeholder', 'title', 'aria-label'].map(a => e.getAttribute(a) ?? '').join(' ')).join('\n'))
  for (const data of ['boss@company.com', 'The Boss', 'name@company.com', 'a@b.co']) text = text.split(data).join(' ')
  const words = [...text.matchAll(/[A-Za-z]{2,}/g)].map(m => m[0]).filter(w => !ALLOWED.test(w))
  expect([...new Set(words)], `English left on ${screen}:\n${text}`).toEqual([])
}

const INVALID = { error: 'invalid_credentials', message: "That email and password combination doesn't match our records. Try again or request access from your administrator." }
const POLICY = { error: 'password_policy', issues: [{ code: 'too_short', message: 'Password must be at least 12 characters.' }, { code: 'needs_symbol', message: 'Must include a symbol.' }] }

async function signIn(page: Page) {
  await page.locator('#email').fill('a@b.co', { timeout: 60_000 })
  await page.locator('#password').fill('wrong-password')
  await page.locator('button[type="submit"]').click()
}

test.describe('sign-in', () => {
  test('the page and the registered notice are Japanese', async ({ page }) => {
    await open(page, '/sign-in?registered=1')
    await expect(page.locator('[data-screen="sign-in"]')).toBeVisible({ timeout: 60_000 })
    await expectNoEnglish(page, 'sign-in')
  })

  test('a wrong password is explained in Japanese', async ({ page }) => {
    await open(page, '/sign-in', { login: { status: 401, body: INVALID } })
    await signIn(page)
    await expect(page.locator('[role="alert"]')).toContainText('記録と一致しません')
    await expectNoEnglish(page, 'sign-in')
  })

  test('in English the wrong-password message is unchanged', async ({ page }) => {
    await open(page, '/sign-in', { language: 'en', login: { status: 401, body: INVALID } })
    await signIn(page)
    await expect(page.locator('[role="alert"]')).toHaveText(INVALID.message)
  })

  test('too many attempts is Japanese too, not the rate limiter\'s English', async ({ page }) => {
    await open(page, '/sign-in', { login: { status: 429, body: { message: 'Rate limit exceeded, retry in 1 minute' } } })
    await signIn(page)
    await expect(page.locator('[role="alert"]')).toContainText('試行回数')
  })

  test('a refusal this screen doesn\'t know keeps the server\'s words', async ({ page }) => {
    await open(page, '/sign-in', { language: 'en', login: { status: 400, body: { error: 'something_new', message: 'A new server message.' } } })
    await signIn(page)
    await expect(page.locator('[role="alert"]')).toHaveText('A new server message.')
  })
})

test.describe('forgot and reset password', () => {
  test('the sent notice is Japanese and keeps the expiry', async ({ page }) => {
    await open(page, '/forgot-password')
    await page.locator('#email').fill('a@b.co', { timeout: 60_000 })
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('[data-auth-notice]')).toContainText('30 分')
    await expectNoEnglish(page, 'forgot-password')
  })

  test('in English the sent notice is unchanged', async ({ page }) => {
    await open(page, '/forgot-password', { language: 'en' })
    await page.locator('#email').fill('a@b.co', { timeout: 60_000 })
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('[data-auth-notice]')).toContainText('If an account exists for a@b.co, a password reset link has been sent. The link expires in 30 minutes.')
  })
})

test.describe('accept invitation', () => {
  const url = `/accept-invitation?token=${TOKEN}`

  test('the register form is Japanese, and the role reads as a proper name', async ({ page }) => {
    await open(page, url)
    await expect(page.locator('[data-invite-role]')).toHaveText('プロジェクトマネージャー', { timeout: 60_000 })
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/accept-ja.png` })
    await expectNoEnglish(page, 'accept-invitation')
  })

  test('in English a PM invitation says Project manager, not Pm', async ({ page }) => {
    await open(page, url, { language: 'en' })
    await expect(page.locator('[data-invite-role]')).toHaveText('Project manager', { timeout: 60_000 })
  })

  test('an expired invitation is Japanese', async ({ page }) => {
    await open(page, url, { invite: { valid: false, reason: 'expired' } })
    await expect(page.locator('[data-screen="accept-invitation"] [role="alert"]')).toBeVisible({ timeout: 60_000 })
    await expectNoEnglish(page, 'accept-invitation')
  })

  async function register(page: Page) {
    await page.locator('#invite-name').fill('The Boss', { timeout: 60_000 })
    await page.locator('#new-password').fill('Str0ng!Passw0rd')
    await page.locator('#confirm-password').fill('Str0ng!Passw0rd')
    await page.locator('input[type="checkbox"]').check()
    await page.locator('button[type="submit"]').click()
  }

  test('password rules the API refuses are Japanese', async ({ page }) => {
    await open(page, url, { register: { status: 400, body: POLICY } })
    await register(page)
    const alert = page.locator('[role="alert"]')
    await expect(alert).toContainText('12 文字以上')
    await expect(alert).toContainText('記号を含める')
    await expectNoEnglish(page, 'accept-invitation')
  })

  test('a link that expires while filling in the form says so in Japanese', async ({ page }) => {
    await open(page, url, { register: { status: 410, body: { error: 'invitation_invalid', reason: 'expired' } } })
    await register(page)
    await expect(page.locator('[role="alert"]')).toBeVisible()
    await expectNoEnglish(page, 'accept-invitation')
  })

  test('registering lands on sign-in with the Japanese notice', async ({ page }) => {
    await open(page, url)
    await register(page)
    await expect(page).toHaveURL(/\/sign-in\?registered=1/, { timeout: 30_000 })
    await expect(page.locator('[data-auth-notice]')).toBeVisible()
    await expectNoEnglish(page, 'sign-in')
  })
})
