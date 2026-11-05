// QA regression — the Notification Centre (bell in the top bar → /notifications) reads the signed-in user's own
// feed from GET /notifications/me and acts through /notifications/me/mark-read, /me/mark-all-read and
// /me/:id/dismiss. It shows loading / error / empty states, never filters to a demo user or pre-selects a fixed
// id, and has no Preferences tab (the API has no preferences endpoint).
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/35-notification-centre.spec.ts
//
// /auth/me and the notification calls are answered inside the page and recorded; nothing is written. Any other
// API call that comes back 401 (no real session in the test) is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

type Call = { method: string; path: string; body: unknown }
type Opts = { feed?: 'ok' | 'empty' | 'fail'; failActions?: boolean }

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

async function open(page: Page, opts: Opts = {}) {
  const feed = [
    { id: 'n-sig', recipientId: 'u-me', kind: 'signature_requested', severity: 'info', title: 'Signature requested: Protocol 7', body: 'Please sign as Approver.\nThe chain started today.', linkPath: '/projects/P1/clinical-writing/documents/D1/sign', channels: ['in_app'], payload: {}, readAt: null, dismissedAt: null, createdAt: minutesAgo(5) },
    { id: 'n-warn', recipientId: 'u-me', kind: 'account.inactivity_warning', severity: 'warning', title: 'Sign in to keep your account active', body: 'Your account has not been used since 2026-10-01.', linkPath: null, channels: ['in_app', 'email'], payload: {}, readAt: null, dismissedAt: null, createdAt: minutesAgo(180) },
    { id: 'n-old', recipientId: 'u-me', kind: 'something_new', severity: 'info', title: 'An older notice', body: 'Already read.', linkPath: null, channels: ['in_app'], payload: {}, readAt: minutesAgo(60), dismissedAt: null, createdAt: minutesAgo(3 * 24 * 60) },
  ]
  await page.addInitScript(({ feed, mode, failActions }) => {
    const me = { id: 'u-me', email: 'mia@example.com', name: 'Mia Member', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const w = window as unknown as { __calls: Call[]; __failFeed: boolean }
    w.__calls = []
    w.__failFeed = mode === 'fail'
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      const m = /\/notifications(\/[^?]*)?(\?.*)?$/.exec(url)
      if (m) {
        const path = `/notifications${m[1] ?? ''}`
        w.__calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (path === '/notifications/me' && method === 'GET') {
          if (w.__failFeed) return json({ error: 'internal', message: 'Database is unavailable' }, 500)
          return json(mode === 'empty' ? [] : feed)
        }
        if (failActions) return json({ error: 'internal', message: 'Server is busy' }, 500)
        if (path === '/notifications/me/mark-read' && method === 'POST') return json({ updated: 1 })
        if (path === '/notifications/me/mark-all-read' && method === 'POST') return json({ updated: 2 })
        if (/^\/notifications\/me\/[^/]+\/dismiss$/.test(path) && method === 'POST') return json({})
        return json({ error: 'not_found' }, 404)                          // anything else is a wrong endpoint
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { feed, mode: opts.feed ?? 'ok', failActions: !!opts.failActions })
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-screen="notification-centre"]')).toBeVisible({ timeout: 60_000 })
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
const row = (page: Page, id: string) => page.locator(`[data-notif-row="${id}"]`)

test('reads the signed-in user’s own feed from /notifications/me, newest first, first one open — no demo user, no fixed id', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-current-user]')).toContainText('Mia Member')
  await expect(page.locator('[data-current-user]')).not.toContainText('Sarah Chen')
  await expect(page.locator('[data-notif-row]')).toHaveCount(3)
  await expect(page.locator('[data-notif-row]').first()).toHaveAttribute('data-notif-row', 'n-sig')
  await expect(page.locator('[data-unread-badge]')).toHaveText('2 unread')

  // the first one is shown, with its type, body (line breaks kept) and link
  await expect(page.locator('[data-active-title]')).toHaveText('Signature requested: Protocol 7')
  await expect(page.locator('[data-active-type]')).toHaveText(/Signature requested/i)
  await expect(page.locator('[data-active-body]')).toContainText('The chain started today.')
  await expect(page.locator('[data-active-action]')).toBeVisible()

  // an unknown kind gets a generic label; a warning carries its severity
  await expect(row(page, 'n-old').locator('[data-notif-type]')).toHaveText(/Notification/i)
  await row(page, 'n-warn').click()
  await expect(page.locator('[data-active-severity]')).toHaveText(/Warning/i)
  await expect(page.locator('[data-active-action]')).toHaveCount(0)        // no link on this one

  const paths = (await calls(page)).map(c => `${c.method} ${c.path}`)
  expect(paths).toContain('GET /notifications/me')
  expect(paths.filter(p => /preferences|^GET \/notifications$|^PATCH/.test(p))).toEqual([])
})

test('there is no Preferences tab', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-tab="inbox"]')).toBeVisible()
  await expect(page.locator('[data-tab="preferences"]')).toHaveCount(0)
  await expect(page.getByText('Preferences', { exact: true })).toHaveCount(0)
})

test('opening an unread notification marks it read through /notifications/me/mark-read', async ({ page }) => {
  await open(page)
  await row(page, 'n-warn').click()
  await expect(row(page, 'n-warn')).toHaveAttribute('data-notif-read', 'true')
  await expect(page.locator('[data-unread-badge]')).toHaveText(/1 unread/)
  const posts = (await calls(page)).filter(c => c.path === '/notifications/me/mark-read')
  expect(posts.map(p => p.body)).toContainEqual({ ids: ['n-warn'] })

  // the Unread filter, then "you've read everything"
  await page.locator('[data-mark-all-read]').click()
  await page.locator('[data-filter-chip="unread"]').click()
  await expect(page.locator('[data-state="empty-filter"]')).toBeVisible()
  expect((await calls(page)).some(c => c.method === 'POST' && c.path === '/notifications/me/mark-all-read')).toBe(true)
  await expect(page.locator('[data-unread-badge]')).toHaveCount(0)
})

test('Dismiss removes the notification through /notifications/me/:id/dismiss', async ({ page }) => {
  await open(page)
  await page.locator('[data-dismiss]').click()
  await expect(row(page, 'n-sig')).toHaveCount(0)
  await expect(page.locator('[data-notif-row]')).toHaveCount(2)
  expect((await calls(page)).some(c => c.method === 'POST' && c.path === '/notifications/me/n-sig/dismiss')).toBe(true)
})

test('an empty inbox says so', async ({ page }) => {
  await open(page, { feed: 'empty' })
  await expect(page.locator('[data-state="empty"]')).toContainText('You have no notifications.')
  await expect(page.locator('[data-inbox-list]')).toHaveCount(0)
})

test('a failed load says so, with the reason, and Try again reloads', async ({ page }) => {
  await open(page, { feed: 'fail' })
  const err = page.locator('[data-state="error"]')
  await expect(err).toBeVisible({ timeout: 30_000 })
  await expect(err).toContainText('couldn’t be loaded')
  await page.evaluate(() => { (window as unknown as { __failFeed: boolean }).__failFeed = false })
  await err.locator('[data-action="retry"]').click()
  await expect(page.locator('[data-notif-row]')).toHaveCount(3)
})

test('a failed action is reported, not swallowed', async ({ page }) => {
  await open(page, { failActions: true })
  await page.locator('[data-dismiss]').click()
  await expect(page.locator('[data-action-error]')).toContainText('That didn’t work')
  await expect(row(page, 'n-sig')).toBeVisible()                         // reloaded: it is still there
})
