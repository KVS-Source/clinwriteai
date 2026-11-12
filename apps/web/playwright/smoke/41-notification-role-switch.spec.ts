// QA regression — Notifications and the role switcher: a user holding Project manager + Contributor sees
// every notification, but one meant for the other role (forRole from the API) shows a warning with
// "Switch to … and open" instead of its content, and isn't marked read. Switching opens its page as that
// role (or, with no page, the notification itself). Works both ways; single-role users see no warning.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/41-notification-role-switch.spec.ts
//
// /auth/me (honouring X-Active-Role, as the API does) and /notifications/me (+ mark-read) are answered inside
// the page; mark-read calls are kept in localStorage so they survive the reload a switch does. The server
// side is in apps/api (notifications/audience.test.ts, auth/active-role.test.ts). Any other API call that
// comes back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const STORAGE_KEY = 'clinwrite.activeRole'
const base = { recipientId: 'u-sourabh', severity: 'info', channels: ['in_app'], payload: {}, readAt: null, dismissedAt: null, createdAt: '2026-11-09T09:00:00Z', context: null, actor: null }
const NOTIFS = [
  { ...base, id: 'n-pm', kind: 'project_manager_added', title: 'You are now a project manager on "Final Project"', body: 'PM-ONLY-BODY', linkPath: '/projects/PROJ-FINAL-PROJECT', forRole: 'pm' },
  { ...base, id: 'n-sign', kind: 'signature_requested', title: 'Your signature is needed on "CSR Full"', body: 'CONTRIBUTOR-BODY', linkPath: null, forRole: 'contributor' },
  { ...base, id: 'n-inv', kind: 'user.invitation', title: 'You have been invited to ClinWrite', body: 'NEUTRAL-BODY', linkPath: null, forRole: null },
]

async function signIn(page: Page, opts: { held: string[]; active?: string; notifs?: typeof NOTIFS }) {
  await page.addInitScript(({ held, active, notifs, key }) => {
    if (active && !sessionStorage.getItem('e2e-seeded')) {
      localStorage.setItem(key, JSON.stringify({ userId: 'u-sourabh', role: active }))
      localStorage.removeItem('e2e-read')
      sessionStorage.setItem('e2e-seeded', '1')
    }
    const read = (): string[] => JSON.parse(localStorage.getItem('e2e-read') ?? '[]')
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') {
        const asRole = new Headers(init?.headers).get('X-Active-Role')
        const role = asRole && held.length > 1 && held.includes(asRole) ? asRole : null
        return json({ id: 'u-sourabh', email: 's@mailinator.com', name: 'Sourabh', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null,
          role: role ?? held[0], roles: role ? [role] : held, allRoles: held })
      }
      if (/\/notifications\/me\/unread-count$/.test(url)) return json({ count: notifs.filter(n => !read().includes(n.id)).length })
      if (/\/notifications\/me\/mark-read$/.test(url) && method === 'POST') {
        const ids = (JSON.parse(String(init?.body ?? '{}')) as { ids: string[] }).ids
        localStorage.setItem('e2e-read', JSON.stringify([...read(), ...ids]))
        return json({ updated: ids.length })
      }
      if (/\/notifications\/me(\?.*)?$/.test(url) && method === 'GET') {
        return json(notifs.map(n => ({ ...n, readAt: read().includes(n.id) ? '2026-11-09T10:00:00Z' : null })))
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { held: opts.held, active: opts.active ?? null, notifs: opts.notifs ?? NOTIFS, key: STORAGE_KEY })
  await page.goto('/notifications')
  await expect(page.locator('[data-notif-row]')).toHaveCount((opts.notifs ?? NOTIFS).length, { timeout: 60_000 })
}

const marked = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('e2e-read') ?? '[]') as string[])
const row = (page: Page, id: string) => page.locator(`[data-notif-row="${id}"]`)
const notice = (page: Page) => page.locator('[data-role-switch-notice]')
const currentRole = (page: Page) => page.locator('[data-persona-trigger] [data-current-role]')

test('as Contributor, a PM notification is flagged and asks to switch instead of opening', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'contributor' })
  await expect(row(page, 'n-pm').locator('[data-notif-for-role="pm"]')).toHaveText('For Project Manager')
  await expect(row(page, 'n-sign').locator('[data-notif-for-role]')).toHaveCount(0)
  await expect(row(page, 'n-inv').locator('[data-notif-for-role]')).toHaveCount(0)

  // The PM notification is first, so it is shown on arrival: a warning, not its content.
  await expect(notice(page)).toHaveAttribute('data-role-switch-notice', 'pm')
  await expect(notice(page)).toContainText('This notification is for your Project Manager role')
  await expect(notice(page)).toContainText("You're working as Contributor")
  await expect(page.getByText('PM-ONLY-BODY')).toHaveCount(0)
  await expect(page.locator('[data-active-action]')).toHaveCount(0)
  expect(await marked(page)).not.toContain('n-pm')

  // Its own notifications open as usual and are marked read.
  await row(page, 'n-sign').click()
  await expect(page.locator('[data-active-body]')).toHaveText('CONTRIBUTOR-BODY')
  await expect(notice(page)).toHaveCount(0)
  await expect.poll(() => marked(page)).toContain('n-sign')

  // Back to the PM one: still the warning.
  await row(page, 'n-pm').click()
  await expect(notice(page)).toBeVisible()
})

test('switching from the warning opens the PM page as Project Manager', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'contributor' })
  await row(page, 'n-pm').click()
  await page.locator('[data-action="switch-role-open"]').click()

  await expect(page).toHaveURL(/\/projects\/PROJ-FINAL-PROJECT$/, { timeout: 60_000 })
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'pm', { timeout: 60_000 })
  expect(JSON.parse((await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY))!)).toEqual({ userId: 'u-sourabh', role: 'pm' })
  expect(await marked(page)).toContain('n-pm')
})

test('and the other way: as PM, a Contributor notification asks to switch, then shows it', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'pm' })
  await expect(row(page, 'n-sign').locator('[data-notif-for-role="contributor"]')).toHaveText('For Contributor')
  await expect(row(page, 'n-pm').locator('[data-notif-for-role]')).toHaveCount(0)

  // The PM notification is first and opens normally for a PM.
  await expect(page.locator('[data-active-body]')).toHaveText('PM-ONLY-BODY')

  await row(page, 'n-sign').click()
  await expect(notice(page)).toContainText('This notification is for your Contributor role')
  await expect(page.getByText('CONTRIBUTOR-BODY')).toHaveCount(0)
  expect(await marked(page)).not.toContain('n-sign')

  // No page to open: switching lands on the notification itself, now readable.
  await page.locator('[data-action="switch-role-open"]').click()
  await expect(page).toHaveURL(/\/notifications\?open=n-sign$/, { timeout: 60_000 })
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })
  await expect(page.locator('[data-active-body]')).toHaveText('CONTRIBUTOR-BODY', { timeout: 60_000 })
  await expect(notice(page)).toHaveCount(0)
  expect(await marked(page)).toContain('n-sign')
})

test('a single-role user sees no role flags or warnings', async ({ page }) => {
  await signIn(page, { held: ['contributor'], notifs: NOTIFS.map(n => ({ ...n, forRole: null })) })
  await expect(page.locator('[data-notif-for-role]')).toHaveCount(0)
  await expect(page.locator('[data-active-body]')).toHaveText('PM-ONLY-BODY')
  await expect(notice(page)).toHaveCount(0)
})

// Back button after switching: the page that comes back must be for the role now in use, never the old
// page frozen mid-"Switching…" (the browser's back/forward cache), and a switch in another tab is picked up.
test('Back after switching shows the page as the new role, not the old one mid-switch', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'pm' })
  await row(page, 'n-sign').click()
  await page.locator('[data-action="switch-role-open"]').click()
  await expect(page).toHaveURL(/\/notifications\?open=n-sign$/, { timeout: 60_000 })
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })

  await page.goBack()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })
  await expect(page.getByText('Switching…')).toHaveCount(0)
  // As Contributor, the signature request opens normally; the PM one now asks to switch.
  await row(page, 'n-sign').click()
  await expect(page.locator('[data-active-body]')).toHaveText('CONTRIBUTOR-BODY')
  await expect(row(page, 'n-pm').locator('[data-notif-for-role="pm"]')).toBeVisible()
})

test('a page restored from the back/forward cache as the old role reloads as the role in use', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'pm' })
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'pm')
  // What the browser does on Back to a cached page after the role was switched elsewhere.
  await page.evaluate(k => {
    localStorage.setItem(k, JSON.stringify({ userId: 'u-sourabh', role: 'contributor' }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  }, STORAGE_KEY)
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })
})

test('a role switch in another tab reloads this one as that role', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'pm' })
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'pm')
  await page.evaluate(k => {
    const value = JSON.stringify({ userId: 'u-sourabh', role: 'contributor' })
    localStorage.setItem(k, value)
    window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: value }))
  }, STORAGE_KEY)
  await expect(currentRole(page)).toHaveAttribute('data-current-role', 'contributor', { timeout: 60_000 })
})

test('a normal page show (not from the cache) with the same role does not reload', async ({ page }) => {
  await signIn(page, { held: ['pm', 'contributor'], active: 'pm' })
  await page.evaluate(() => { (window as unknown as { __marker: boolean }).__marker = true })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(true)
})
