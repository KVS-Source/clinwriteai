// QA regression — demo "Switch persona" pop-up with two-role users (e.g. Abhishek, Sheetal: Contributor + PM).
//  - The pop-up lists anyone holding PM under Project Managers and shows both roles.
//  - Picking one opens as that person with both roles and the role switcher.
//  - Each persona keeps its own role choice; one persona's choice is never sent for another.
//
// Runs only against a demo-mode build (persona switcher on):
//   VITE_BYPASS_AUTH=true npx vite --port 5174
//   E2E_BASE_URL=http://localhost:5174 E2E_CHANNEL=msedge npx playwright test playwright/smoke/55-persona-switch-multi-role.spec.ts
//
// The API is answered inside the page the way it does it: /auth/demo-personas lists everyone with `roles`,
// /auth/me answers as the X-Demo-Persona user, narrowed to a held role named on X-Active-Role.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PEOPLE = [
  { id: 'u-alex',    name: 'Alex Thornton', email: 'alex@example.com',    roles: ['pm'] },
  { id: 'u-abhi',    name: 'Abhishek',      email: 'abhi@example.com',    roles: ['contributor', 'pm'] },
  { id: 'u-sheetal', name: 'Sheetal',       email: 'sheetal@example.com', roles: ['contributor', 'pm'] },
  { id: 'u-karan',   name: 'Karan',         email: 'karan@example.com',   roles: ['contributor'] },
]

async function open(page: Page) {
  await page.addInitScript((people) => {
    const w = window as unknown as { __calls: Array<{ persona: string | null; role: string | null }> }
    w.__calls = []
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      const h = new Headers(init?.headers)
      const persona = h.get('X-Demo-Persona'); const asRole = h.get('X-Active-Role')
      if (p.endsWith('/auth/demo-personas')) {
        return json(people.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.roles[0], roles: u.roles, modules: ['A'], status: 'active', lastActive: null, tenantId: 't1' })))
      }
      if (p.endsWith('/auth/me')) {
        w.__calls.push({ persona, role: asRole })
        const u = people.find(x => x.id === persona) ?? people[0]!
        const role = asRole && u.roles.length > 1 && u.roles.includes(asRole) ? asRole : null
        return json({ id: u.id, email: u.email, name: u.name, modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 't1',
          role: role ?? u.roles[0], roles: role ? [role] : u.roles, allRoles: u.roles })
      }
      if (p.endsWith('/auth/logout')) return json({ ok: true })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, PEOPLE)
  await page.goto('/home')
  await expect(page.locator('[data-persona-trigger]')).toBeVisible({ timeout: 60_000 })
}

const trigger = (page: Page) => page.locator('[data-persona-trigger]')
const menu = (page: Page) => page.locator('[data-persona-menu]')

async function switchPersona(page: Page, id: string) {
  await trigger(page).click()
  await menu(page).locator(`[data-persona-option="${id}"]`).click()
  await expect(trigger(page)).toHaveAttribute('data-current-user-id', id, { timeout: 60_000 })
}

test.beforeEach(async ({ baseURL }) => {
  test.skip(!/5174/.test(baseURL ?? ''), 'needs the demo-mode build (persona switcher) on port 5174')
})

test('the pop-up files Contributor + PM users under Project Managers and shows both roles', async ({ page }) => {
  await open(page)
  await trigger(page).click()
  await expect(menu(page)).toBeVisible()
  const pmGroup = menu(page).locator('p', { hasText: /^Project Managers$/i })
  await expect(pmGroup).toBeVisible({ timeout: 30_000 })
  for (const id of ['u-abhi', 'u-sheetal']) {
    const opt = menu(page).locator(`[data-persona-option="${id}"]`)
    await expect(opt).toHaveAttribute('data-persona-roles', 'contributor,pm')
    await expect(opt).toContainText('Contributor · Project Manager')
  }
  await expect(menu(page).locator('[data-persona-option="u-karan"]')).toContainText('Contributor')
  await expect(menu(page).locator('[data-persona-option="u-karan"]')).not.toContainText('Project Manager')
})

test('switching to a two-role persona shows both roles and the role switcher, and switching role works', async ({ page }) => {
  await open(page)
  await switchPersona(page, 'u-abhi')
  await expect(trigger(page).locator('[data-roles-held]')).toHaveText(/2 roles/)
  await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'contributor')
  await trigger(page).click()
  await menu(page).locator('[data-role-option="pm"]').click()
  await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm', { timeout: 60_000 })
  await expect(trigger(page)).toHaveAttribute('data-current-user-id', 'u-abhi')
})

test("each persona keeps its own role; one persona's choice is never sent for another", async ({ page }) => {
  await open(page)
  await switchPersona(page, 'u-abhi')
  await trigger(page).click()
  await menu(page).locator('[data-role-option="pm"]').click()
  await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm', { timeout: 60_000 })

  // Sheetal has made no choice: she opens in her main role, and Abhishek's "PM" is never sent for her.
  await page.evaluate(() => { (window as unknown as { __calls: unknown[] }).__calls.length = 0 })
  await switchPersona(page, 'u-sheetal')
  await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'contributor')
  const calls = await page.evaluate(() => (window as unknown as { __calls: Array<{ persona: string | null; role: string | null }> }).__calls)
  expect(calls.filter(c => c.persona === 'u-sheetal').every(c => c.role === null || c.role === 'contributor')).toBe(true)

  // Back to Abhishek: still Project Manager.
  await switchPersona(page, 'u-abhi')
  await expect(trigger(page).locator('[data-current-role]')).toHaveAttribute('data-current-role', 'pm')
})
