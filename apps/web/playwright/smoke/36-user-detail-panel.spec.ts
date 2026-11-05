// QA regression — Admin > User Management (as in Genrac): clicking a user opens the User Detail panel on the
// right with their details and their roles. A user holds one or two platform roles (rights are the union):
// "Add another role" adds one alongside the current one, "Slide to revoke" removes one (never the last).
// At most 2; an admin role is never combined, nor Auditor + Contributor. Active users only.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/36-user-detail-panel.spec.ts
//
// /auth/me (an admin session) and /admin/users (list, roles add / revoke, suspend) are answered inside the page
// and recorded; nothing is written. The server's own rules are in apps/api (users/roles.test.ts,
// auth/multi-role.test.ts). Any other API call that comes back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ME = { id: 'u-admin-e2e', email: 'admin.e2e@example.com', name: 'Admin E2E', role: 'tenant-admin', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

const user = (id: string, name: string, role: string, status: string, additionalRoles: string[] = []) => ({
  id, name, email: `${name.toLowerCase().replace(' ', '.')}@mailinator.com`, initials: null, role, additionalRoles, capabilities: [], modules: ['A'], status,
  tenantId: 'tenant-a', tenantName: 'Acme Pharma', tenantRef: null, termsAcceptedAt: '2026-10-05T04:36:00Z', lastActiveAt: '2026-11-04T08:00:00Z',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
})

const USERS = [
  user('u-both', 'Rihan Rao', 'pm', 'active', ['contributor']),
  user('u-pm', 'Priya Mehta', 'pm', 'active'),
  user('u-con', 'Casey Cole', 'contributor', 'active'),
  user('u-adm', 'Ada Admin', 'tenant-admin', 'active'),
  user('u-sus', 'Sam Suspended', 'contributor', 'suspended'),
]

type Call = { method: string; path: string; body: unknown }

async function open(page: Page, opts: { refuseAdd?: boolean } = {}) {
  await page.addInitScript(({ me, users, refuseAdd }) => {
    const w = window as unknown as { __calls: Call[] }
    w.__calls = []
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (/\/admin\/users(\?.*)?$/.test(url) && method === 'GET') return json(users)
      const add = url.match(/\/admin\/users\/([^/]+)\/roles$/)
      if (add && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { role: string }
        w.__calls.push({ method, path: `/admin/users/${add[1]}/roles`, body })
        if (refuseAdd) return json({ error: 'role_combination_not_allowed', message: 'These roles can’t be held together.' }, 409)
        const u = users.find(x => x.id === add[1])!
        u.additionalRoles = [...u.additionalRoles, body.role]
        return json(u)
      }
      const rev = url.match(/\/admin\/users\/([^/]+)\/roles\/([^/?]+)$/)
      if (rev && method === 'DELETE') {
        w.__calls.push({ method, path: `/admin/users/${rev[1]}/roles/${rev[2]}`, body: null })
        const u = users.find(x => x.id === rev[1])!
        const remaining = [u.role, ...u.additionalRoles].filter(r => r !== decodeURIComponent(rev[2]!))
        u.role = remaining[0]!; u.additionalRoles = remaining.slice(1)
        return json(u)
      }
      const s = url.match(/\/admin\/users\/([^/]+)\/(suspend|reactivate)$/)
      if (s && method === 'POST') {
        const u = users.find(x => x.id === s[1])!
        u.status = s[2] === 'suspend' ? 'suspended' : 'active'
        return json(u)
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ME, users: structuredClone(USERS), refuseAdd: !!opts.refuseAdd })
  await page.goto('/admin/users')
  await expect(page.locator('[data-user-row]')).toHaveCount(USERS.length, { timeout: 60_000 })
}

const panel = (page: Page) => page.locator('[data-panel="user-detail"]')
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
const openUser = async (page: Page, id: string) => {
  await page.locator(`[data-user-row="${id}"] td`).first().click()
  await expect(panel(page)).toHaveAttribute('data-user-id', id)
}
const select = (page: Page) => panel(page).locator('[data-input="add-role"]')

test('a row click opens User Detail: details list every role; no platform-role dropdown or capability box', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-user-row="u-both"] [data-user-roles]')).toHaveText('Project manager, Contributor')
  await openUser(page, 'u-both')
  await expect(panel(page).locator('[data-detail-name]')).toHaveText('Rihan Rao')
  await expect(panel(page).locator('[data-detail-email]')).toHaveText('r****.***@mailinator.com')
  await expect(panel(page).locator('[data-detail-role]')).toHaveText('Project manager, Contributor')
  await expect(panel(page).locator('[data-roles-count]')).toHaveText('2 active')
  await expect(panel(page).locator('[data-role-item]')).toHaveText([/Project manager/, /Contributor/])
  await expect(panel(page).locator('[data-input="platform-role"]')).toHaveCount(0)
  await expect(panel(page).locator('[data-action="edit-user"]')).toHaveCount(0)
  // at the maximum of 2
  await expect(select(page)).toBeDisabled()
  await expect(panel(page).locator('[data-roles-max]')).toContainText('maximum of 2 roles')
})

test('Add another role adds Contributor alongside Project manager (the current role stays)', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-pm')
  await expect(select(page).locator('option')).toHaveText(['Select a role', /Tenant admin — can’t be combined/, 'Contributor', 'Auditor'])
  await expect(select(page).locator('option', { hasText: 'Tenant admin' })).toBeDisabled()
  await select(page).selectOption('contributor')
  await panel(page).locator('[data-action="add-role"]').click()

  await expect(panel(page).locator('[data-role-item]')).toHaveText([/Project manager/, /Contributor/])
  await expect(panel(page).locator('[data-detail-role]')).toHaveText('Project manager, Contributor')
  await expect(panel(page).locator('[data-roles-message="success"]')).toContainText('Contributor')
  await expect(page.locator('[data-user-row="u-pm"] [data-user-roles]')).toHaveText('Project manager, Contributor')
  expect(await calls(page)).toEqual([{ method: 'POST', path: '/admin/users/u-pm/roles', body: { role: 'contributor' } }])
})

test('a Contributor can’t be given Auditor; an admin can’t be given anything', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-con')
  await expect(select(page).locator('option', { hasText: 'Auditor' })).toBeDisabled()
  await expect(select(page).locator('option', { hasText: 'Project manager' })).toBeEnabled()

  await openUser(page, 'u-adm')
  for (const label of ['Project manager', 'Contributor', 'Auditor']) await expect(select(page).locator('option', { hasText: label })).toBeDisabled()
  await expect(panel(page).locator('[data-roles-admin-alone]')).toBeVisible()
})

test('sliding a role to the end revokes it; letting go early does not; the last role can’t be revoked', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-both')
  const slider = panel(page).locator('[data-role-item="contributor"] [data-action="slide-revoke"]')
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  const drag = async (to: number) => {
    await page.mouse.move(box.x + 10, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * to, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  await drag(0.5)
  await expect(panel(page).locator('[data-role-item]')).toHaveCount(2)
  expect(await calls(page)).toEqual([])

  await drag(0.99)
  await expect(panel(page).locator('[data-role-item]')).toHaveCount(1)
  expect(await calls(page)).toEqual([{ method: 'DELETE', path: '/admin/users/u-both/roles/contributor', body: null }])
  await expect(panel(page).locator('[data-detail-role]')).toHaveText('Project manager')
  // one left: it can't be revoked
  await expect(panel(page).locator('[data-role-item="pm"] [data-action="slide-revoke"]')).toBeDisabled()
})

test('the slider works from the keyboard too (End revokes)', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-both')
  const slider = panel(page).locator('[data-role-item="pm"] [data-action="slide-revoke"]')
  await expect(slider).toHaveAccessibleName('Slide to revoke Project manager')
  await slider.focus()
  await page.keyboard.press('End')
  await expect(panel(page).locator('[data-role-item]')).toHaveText([/Contributor/])
  expect(await calls(page)).toEqual([{ method: 'DELETE', path: '/admin/users/u-both/roles/pm', body: null }])
})

test('roles can only be changed for active users', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-sus')
  await expect(panel(page).locator('[data-roles-inactive]')).toContainText('only available for active users')
  await expect(select(page)).toHaveCount(0)
  await expect(panel(page).locator('[data-action="slide-revoke"]')).toBeDisabled()
})

test('a refused change is shown in the panel', async ({ page }) => {
  await open(page, { refuseAdd: true })
  await openUser(page, 'u-pm')
  await select(page).selectOption('auditor')
  await panel(page).locator('[data-action="add-role"]').click()
  await expect(panel(page).locator('[data-roles-message="error"]')).toContainText('can’t be held together')
  await expect(panel(page).locator('[data-role-item]')).toHaveCount(1)
})

test('the role filter finds a user by their second role', async ({ page }) => {
  await open(page)
  await page.locator('[data-filter="role"]').selectOption('contributor')
  const ids = await page.locator('[data-user-row]').evaluateAll(rows => rows.map(r => r.getAttribute('data-user-row')))
  expect(ids).toEqual(['u-both', 'u-con', 'u-sus'])
})

test('clicking another row switches the panel; row actions don’t open it; Suspend from the panel', async ({ page }) => {
  await open(page)
  await openUser(page, 'u-pm')
  await openUser(page, 'u-con')
  await panel(page).locator('[data-action="panel-suspend"]').click()
  await expect(panel(page).locator('[data-action="panel-unsuspend"]')).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(panel(page)).toHaveCount(0)
  await page.locator('[data-user-row="u-sus"] [data-action="unsuspend"]').click()
  await expect(panel(page)).toHaveCount(0)
})
