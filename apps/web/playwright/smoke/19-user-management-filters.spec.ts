// QA regression — Admin > User Management filter bar (status, role, search by name / email, clear)
// and sortable table columns.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/19-user-management-filters.spec.ts
//
// /auth/me (an admin session) and /admin/users are answered inside the page; nothing is written. Any other
// API call that comes back 401 (no real session in the test) is turned into a 503 so the shell's side panels
// show an error instead of redirecting the page to /sign-in. Works with real sign-in or the dev bypass.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ME = {
  id: 'u-admin-e2e', email: 'admin.e2e@example.com', name: 'Admin E2E', role: 'tenant-admin',
  modules: ['A', 'B', 'C', 'D', 'E'], status: 'active', lastActiveAt: null, tenantId: null,
}

const u = (id: string, name: string, role: string, status: string, tenantId: string | null, lastActiveAt: string | null) => ({
  id, name, email: `${name.toLowerCase().replace(' ', '.')}@example.com`, initials: null, role, modules: ['A'],
  status, tenantId, lastActiveAt, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
})

// API order (newest first); every column has distinct values so sort order is unambiguous.
const USERS = [
  u('emp-1001', 'Alice Archer',  'contributor',     'active',        'tenant-b', '2026-11-03T10:00:00Z'),
  u('emp-1002', 'Bruno Baker',   'tenant-admin',    'invited',       null,       null),
  u('emp-1003', 'Chitra Chopra', 'auditor',         'suspended',     'tenant-a', '2026-10-01T10:00:00Z'),
  u('emp-1004', 'Dev Desai',     'contributor',     'active',        'tenant-a', '2026-11-04T08:00:00Z'),
  u('emp-1005', 'Esha Elango',   'clinical-writer', 'deprovisioned', null,       null),   // legacy role
]

async function openUserManagement(page: Page) {
  await page.addInitScript(({ me, users }) => {
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (/\/admin\/users(\?.*)?$/.test(url) && method === 'GET') return json(users)
      const reactivate = url.match(/\/admin\/users\/([^/]+)\/reactivate$/)
      if (reactivate && method === 'POST') {
        const u = users.find(x => x.id === reactivate[1])!
        u.status = 'active'
        return json(u)
      }
      if (/\/admin\/users(\?.*)?$/.test(url) && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        ;(window as unknown as { __invites: unknown[] }).__invites = [...((window as unknown as { __invites?: unknown[] }).__invites ?? []), body]
        // Like the API: the new user joins the list, so the refetch shows the new record.
        const created = { ...body, id: 'emp-new', initials: null, tenantId: null, lastActiveAt: null, status: 'invited',
          createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' }
        users.unshift(created)
        return json({ ...created, inviteUrl: 'http://x/accept-invitation?token=t', inviteExpiresAt: '2026-11-11T00:00:00Z' }, 201)
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ME, users: USERS })
  await page.goto('/admin/users')
  await expect(page.locator('[data-user-row]')).toHaveCount(USERS.length, { timeout: 60_000 })
}

const rowIds = (page: Page) =>
  page.locator('[data-user-row]').evaluateAll(rows => rows.map(r => r.getAttribute('data-user-row')))

const status = (page: Page) => page.locator('[data-filter="status"]')
const role   = (page: Page) => page.locator('[data-filter="role"]')
const search = (page: Page) => page.locator('[data-filter="search"]')
const clear  = (page: Page) => page.locator('[data-section="user-filters"] [data-action="clear-filters"]')

test('the filter bar shows grey "All Status" / "All Roles" placeholders, the search field and a disabled Clear filters', async ({ page }) => {
  await openUserManagement(page)
  // No filter chosen: each dropdown shows its placeholder, in grey like the search placeholder.
  await expect(status(page).locator('option:checked')).toHaveText('All Status')
  await expect(role(page).locator('option:checked')).toHaveText('All Roles')
  await expect(status(page)).toHaveAttribute('data-placeholder-shown', 'true')
  await expect(role(page)).toHaveAttribute('data-placeholder-shown', 'true')
  await expect(status(page)).toHaveCSS('color', 'rgb(148, 163, 184)')        // slate-400
  // The placeholder is not a choice in the list; "All …" is.
  await expect(status(page).locator('option[value=""]')).toHaveAttribute('hidden', '')
  await expect(status(page).locator('option:not([hidden])').first()).toHaveText('All Status')
  await expect(search(page)).toHaveAttribute('placeholder', 'Search by name...')
  await expect(clear(page)).toBeDisabled()
  await expect(page.getByText('5 users', { exact: true })).toBeVisible()
  // only the five standard roles are offered — no legacy roles such as clinical-writer
  await expect(role(page).locator('option:not([hidden])')).toHaveText(['All Roles', 'Tenant admin', 'Project manager', 'Contributor', 'Auditor', 'Guest'])
  await expect(role(page).locator('option[value="clinical-writer"]')).toHaveCount(0)
})

test('status filter narrows the rows and the count', async ({ page }) => {
  await openUserManagement(page)
  await status(page).selectOption('active')
  expect(await rowIds(page)).toEqual(['emp-1001', 'emp-1004'])
  await expect(page.getByText('Showing 2 of 5 users')).toBeVisible()
  await expect(clear(page)).toBeEnabled()
})

test('role filter narrows the rows', async ({ page }) => {
  await openUserManagement(page)
  await role(page).selectOption('contributor')
  expect(await rowIds(page)).toEqual(['emp-1001', 'emp-1004'])
})

test('search matches name and email, case-insensitively — not the internal user ID', async ({ page }) => {
  await openUserManagement(page)
  await search(page).fill('BRUNO')
  expect(await rowIds(page)).toEqual(['emp-1002'])
  await search(page).fill('emp-1003')
  await expect(page.locator('[data-user-row]')).toHaveCount(0)
  await search(page).fill('esha.elango@')
  expect(await rowIds(page)).toEqual(['emp-1005'])
})

test('filters combine (AND) and Clear filters resets all three', async ({ page }) => {
  await openUserManagement(page)
  await status(page).selectOption('active')
  await role(page).selectOption('contributor')
  await search(page).fill('dev')
  expect(await rowIds(page)).toEqual(['emp-1004'])

  await clear(page).click()
  // Cleared: back to the placeholders.
  await expect(status(page)).toHaveValue('')
  await expect(role(page)).toHaveValue('')
  await expect(status(page)).toHaveAttribute('data-placeholder-shown', 'true')
  await expect(search(page)).toHaveValue('')
  await expect(page.locator('[data-user-row]')).toHaveCount(5)
  await expect(clear(page)).toBeDisabled()
})

test('no match shows an empty-state row whose Clear filters link restores the list', async ({ page }) => {
  await openUserManagement(page)
  await search(page).fill('zzz-nobody')
  await expect(page.locator('[data-user-row]')).toHaveCount(0)
  const empty = page.locator('[data-empty-filtered]')
  await expect(empty).toContainText('No users match these filters.')
  await empty.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.locator('[data-user-row]')).toHaveCount(5)
})

test('User column sorts by name, toggling ascending / descending', async ({ page }) => {
  await openUserManagement(page)
  const header = page.locator('[data-sort="name"]')
  await header.click()
  expect(await rowIds(page)).toEqual(['emp-1001', 'emp-1002', 'emp-1003', 'emp-1004', 'emp-1005'])
  await expect(page.locator('th', { has: header })).toHaveAttribute('aria-sort', 'ascending')
  await header.click()
  expect(await rowIds(page)).toEqual(['emp-1005', 'emp-1004', 'emp-1003', 'emp-1002', 'emp-1001'])
  await expect(page.locator('th', { has: header })).toHaveAttribute('aria-sort', 'descending')
})

test('Last active sorts newest first, with never-active users always last', async ({ page }) => {
  await openUserManagement(page)
  await page.locator('[data-sort="lastActive"]').click()   // first click = newest first
  expect(await rowIds(page)).toEqual(['emp-1004', 'emp-1001', 'emp-1003', 'emp-1002', 'emp-1005'])
  await page.locator('[data-sort="lastActive"]').click()   // oldest first; never-active still at the bottom
  expect(await rowIds(page)).toEqual(['emp-1003', 'emp-1001', 'emp-1004', 'emp-1002', 'emp-1005'])
})

test('Status sorts in lifecycle order and Tenant sorts with blank tenants last', async ({ page }) => {
  await openUserManagement(page)
  await page.locator('[data-sort="status"]').click()
  expect(await rowIds(page)).toEqual(['emp-1001', 'emp-1004', 'emp-1002', 'emp-1003', 'emp-1005'])
  await page.locator('[data-sort="tenant"]').click()
  expect(await rowIds(page)).toEqual(['emp-1003', 'emp-1004', 'emp-1001', 'emp-1002', 'emp-1005'])
})

test('sorting applies to the filtered rows', async ({ page }) => {
  await openUserManagement(page)
  await status(page).selectOption('active')
  await page.locator('[data-sort="name"]').click()
  await page.locator('[data-sort="name"]').click()   // descending
  expect(await rowIds(page)).toEqual(['emp-1004', 'emp-1001'])
})

test('Invite user asks only for email and role, and sends a name derived from the email with no tenant', async ({ page }) => {
  await openUserManagement(page)
  await page.locator('[data-action="toggle-invite"]').click()
  const form = page.locator('[data-section="invite-user"]')
  await expect(form.locator('[data-input="email"]')).toBeVisible()
  await expect(form.locator('[data-input="role"]')).toBeVisible()
  await expect(form.locator('[data-input="name"], [data-input="tenantId"]')).toHaveCount(0)
  await expect(form.getByText(/display name|tenant id/i)).toHaveCount(0)

  // The role starts empty, showing a grey "Select a role" placeholder that is not a choice in the list.
  const roleSelect = form.locator('[data-input="role"]')
  await expect(roleSelect.locator('option:checked')).toHaveText('Select a role')
  await expect(roleSelect).toHaveAttribute('data-placeholder-shown', 'true')
  await expect(roleSelect).toHaveCSS('color', 'rgb(148, 163, 184)')
  await expect(roleSelect.locator('option[value=""]')).toHaveAttribute('hidden', '')

  // Send invite waits for both an email and a role.
  const send = form.locator('[data-action="invite"]')
  await expect(send).toBeDisabled()
  await form.locator('[data-input="email"]').fill(' jane.doe@example.com ')
  await expect(send).toBeDisabled()
  await roleSelect.selectOption('auditor')
  await expect(roleSelect).not.toHaveAttribute('data-placeholder-shown', 'true')
  await expect(roleSelect).not.toHaveCSS('color', 'rgb(148, 163, 184)')
  await send.click()

  await expect(page.locator('[data-section="invite-link"]')).toBeVisible()
  const sent = await page.evaluate(() => (window as unknown as { __invites: Record<string, unknown>[] }).__invites)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ email: 'jane.doe@example.com', name: 'Jane Doe', role: 'auditor' })
  expect(sent[0]).not.toHaveProperty('tenantId')
})

test('emails are masked in the table: first character kept, the rest of the name is *, the domain stays', async ({ page }) => {
  await openUserManagement(page)
  const email = (id: string) => page.locator(`[data-user-row="${id}"] [data-user-email]`)
  await expect(email('emp-1001')).toHaveText('a****.******@example.com')        // alice.archer@example.com
  await expect(email('emp-1005')).toHaveText('e***.******@example.com')         // esha.elango@example.com
  for (const u of USERS) await expect(page.locator(`[data-user-row="${u.id}"]`)).not.toContainText(u.email)
})

test('a newly invited user shows up with the email masked', async ({ page }) => {
  await openUserManagement(page)
  await page.locator('[data-action="toggle-invite"]').click()
  await page.locator('[data-section="invite-user"] [data-input="email"]').fill('new.person@acme.io')
  await page.locator('[data-section="invite-user"] [data-input="role"]').selectOption('contributor')
  await page.locator('[data-section="invite-user"] [data-action="invite"]').click()

  const row = page.locator('[data-user-row="emp-new"]')
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.locator('[data-user-email]')).toHaveText('n**.******@acme.io')
  await expect(row).not.toContainText('new.person@acme.io')
})

test('a suspended account shows Suspended with an Unsuspend button (not Suspend); Unsuspend makes it active again', async ({ page }) => {
  await openUserManagement(page)
  const suspendedRow = page.locator('[data-user-row="emp-1003"]')            // Chitra Chopra — suspended
  await expect(suspendedRow).toContainText('Suspended')
  await expect(suspendedRow.locator('[data-action="unsuspend"]')).toHaveText('Unsuspend')
  await expect(suspendedRow.locator('[data-action="suspend"]')).toHaveCount(0)

  const activeRow = page.locator('[data-user-row="emp-1001"]')               // Alice Archer — active
  await expect(activeRow.locator('[data-action="suspend"]')).toHaveText('Suspend')
  await expect(activeRow.locator('[data-action="unsuspend"]')).toHaveCount(0)

  await suspendedRow.locator('[data-action="unsuspend"]').click()
  await expect(suspendedRow).toContainText('Active')
  await expect(suspendedRow.locator('[data-action="suspend"]')).toHaveText('Suspend')
  await expect(suspendedRow.locator('[data-action="unsuspend"]')).toHaveCount(0)
})

test('choosing a filter shows it in dark text; choosing "All …" brings the placeholder back', async ({ page }) => {
  await openUserManagement(page)
  await status(page).selectOption('active')
  await expect(status(page).locator('option:checked')).toHaveText('Active')
  await expect(status(page)).not.toHaveAttribute('data-placeholder-shown', 'true')
  await expect(status(page)).not.toHaveCSS('color', 'rgb(148, 163, 184)')    // no longer the grey placeholder
  await status(page).selectOption('all')
  await expect(status(page).locator('option:checked')).toHaveText('All Status')
  await expect(status(page)).toHaveAttribute('data-placeholder-shown', 'true')
  await expect(page.getByText('5 users', { exact: true })).toBeVisible()

  await role(page).selectOption('auditor')
  await expect(role(page).locator('option:checked')).toHaveText('Auditor')
  await role(page).selectOption('all')
  await expect(role(page).locator('option:checked')).toHaveText('All Roles')
})
