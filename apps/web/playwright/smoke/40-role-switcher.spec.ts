// QA regression — Role switcher (as in Genrac): a user who holds two roles (e.g. Project manager +
// Contributor) sees every role they hold in the account menu, works as one at a time, and switches from
// the top bar. The choice is sent to the API on every request (X-Active-Role) so the server answers as
// that role; it survives a reload and belongs to the user it was made for. A single-role user sees no
// switcher and sends no header.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/40-role-switcher.spec.ts
//
// /auth/me is answered inside the page the way the API does it (role / roles narrowed to a held role
// named on X-Active-Role, allRoles = every role held) and the header on each call is recorded. The
// server's own rule is in apps/api/src/auth/active-role.test.ts. Any other API call that comes back 401
// is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const TWO_ROLES = { id: 'u-sourabh', email: 'sourabh@mailinator.com', name: 'Sourabh', held: ['pm', 'contributor'] }
const ONE_ROLE = { id: 'u-karan', email: 'karan@mailinator.com', name: 'Karan', held: ['contributor'] }
const STORAGE_KEY = 'clinwrite.activeRole'

type Who = typeof TWO_ROLES

async function signIn(page: Page, who: Who, stored?: { userId: string; role: string }) {
  await page.addInitScript(({ who, stored, key }) => {
    if (stored && !sessionStorage.getItem('e2e-seeded')) {
      localStorage.setItem(key, JSON.stringify(stored))
      sessionStorage.setItem('e2e-seeded', '1')
    }
    const w = window as unknown as { __roleHeaders: Array<string | null> }
    w.__roleHeaders = []
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const asRole = new Headers(init?.headers).get('X-Active-Role')
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') {
        w.__roleHeaders.push(asRole)
        const role = asRole && who.held.length > 1 && who.held.includes(asRole) ? asRole : null
        return json({
          id: who.id, email: who.email, name: who.name, modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 'tenant-a',
          role: role ?? who.held[0], roles: role ? [role] : who.held, allRoles: who.held,
        })
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { who, stored: stored ?? null, key: STORAGE_KEY })
  await page.goto('/home')
  await expect(page.locator('[data-persona-trigger]')).toHaveAttribute('data-current-user-id', who.id, { timeout: 60_000 })
}

const trigger = (page: Page) => page.locator('[data-persona-trigger]')
const switcher = (page: Page) => page.locator('[data-role-switcher]')

test.describe('Role switcher', () => {
  test('a two-role user sees both roles and works as the primary one by default', async ({ page }) => {
    await signIn(page, TWO_ROLES)
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm')
    await expect(trigger(page)).toContainText('Project Manager')
    await expect(trigger(page).locator('[data-roles-held]')).toHaveText(/2 roles/)

    await trigger(page).click()
    await expect(switcher(page)).toBeVisible()
    await expect(switcher(page).locator('[data-role-option]')).toHaveCount(2)
    await expect(switcher(page).locator('[data-role-option="pm"]')).toHaveAttribute('aria-checked', 'true')
    await expect(switcher(page).locator('[data-role-option="contributor"]')).toHaveAttribute('aria-checked', 'false')
    // The real sign-in account menu also lists every role held under the name.
    const roles = page.locator('[data-account-roles]')
    if (await roles.count()) await expect(roles).toHaveText('Project Manager · Contributor')

    // The primary role is remembered for this user, so the API is told the same from here on.
    expect(JSON.parse((await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY))!)).toEqual({ userId: TWO_ROLES.id, role: 'pm' })
  })

  test('switching to Contributor reloads as Contributor, tells the API, and survives a reload', async ({ page }) => {
    await signIn(page, TWO_ROLES)
    await trigger(page).click()
    await switcher(page).locator('[data-role-option="contributor"]').click()

    await expect(page).toHaveURL(/\/home$/)
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })
    await expect(trigger(page)).toContainText('Contributor')
    expect(await page.evaluate(() => (window as unknown as { __roleHeaders: Array<string | null> }).__roleHeaders)).toContain('contributor')

    await page.reload()
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })

    await trigger(page).click()
    await expect(switcher(page).locator('[data-role-option="contributor"]')).toHaveAttribute('aria-checked', 'true')
    // And back again.
    await switcher(page).locator('[data-role-option="pm"]').click()
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm', { timeout: 60_000 })
  })

  test('a choice saved for another user, or for a role not held, is not used', async ({ page }) => {
    await signIn(page, TWO_ROLES, { userId: 'someone-else', role: 'contributor' })
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm')
    expect(JSON.parse((await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY))!)).toEqual({ userId: TWO_ROLES.id, role: 'pm' })
  })

  test('a single-role user sees no switcher and sends no role header', async ({ page }) => {
    await signIn(page, ONE_ROLE)
    await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'contributor')
    await expect(trigger(page).locator('[data-roles-held]')).toHaveCount(0)
    await trigger(page).click()
    await expect(switcher(page)).toHaveCount(0)
    expect(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY)).toBeNull()
    const headers = await page.evaluate(() => (window as unknown as { __roleHeaders: Array<string | null> }).__roleHeaders)
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every(v => v === null)).toBe(true)
  })
})
