// QA regression — TA Tags moved from the IT Admin menu to the Project Manager menu.
//   - A PM sees "TA Tags" in the sidebar, opens /admin/taxonomy and can add a tag.
//   - IT Admin no longer sees it in the sidebar, and /admin/taxonomy sends them home.
//   - A Contributor doesn't see it either.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/45-ta-tags-pm-page.spec.ts
//
// /auth/me and the TA list are answered inside the page; the add call is recorded on window.__calls.
// The server rule (only a PM writes TA tags) is in apps/api taxonomy/routes.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM    = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const ADMIN = { ...PM, id: 'u-admin', email: 'ivy@example.com', name: 'Ivy Admin', role: 'tenant-admin', modules: ['A', 'B', 'C', 'D', 'E'] }
const CON   = { ...PM, id: 'u-con', email: 'cora@example.com', name: 'Cora', role: 'contributor' }

async function open(page: Page, me: Record<string, unknown>, path: string) {
  await page.addInitScript((me) => {
    const w = window as unknown as { __calls: Array<{ method: string; path: string; body: unknown }> }
    w.__calls = []
    const rows = [{ code: 'ONC', label: 'Oncology', parentCode: null, status: 'active', projectCount: 2, documentCount: 5, createdAt: '2026-10-01T09:00:00.000Z', createdBy: 'u-pm', archivedAt: null }]
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const u = new URL(url, location.origin)
      const m = (init?.method ?? 'GET').toUpperCase()
      if (u.pathname.endsWith('/auth/me')) return json(me)
      if (u.pathname.endsWith('/taxonomy/therapeutic-areas') && m === 'GET') return json(rows)
      if (u.pathname.endsWith('/admin/taxonomy/therapeutic-areas') && m === 'POST') {
        const body = JSON.parse(String(init!.body))
        w.__calls.push({ method: m, path: u.pathname.replace(/^.*(\/admin\/)/, '$1'), body })
        const row = { code: body.code, label: body.label, parentCode: null, status: 'active', projectCount: 0, documentCount: 0, createdAt: new Date().toISOString(), createdBy: (me as { id: string }).id, archivedAt: null }
        rows.push(row)
        return json(row, 201)
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, me)
  await page.goto(path)
}

const taLink = (page: Page) => page.locator('[data-platform-link="/admin/taxonomy"]')

test('a PM sees TA Tags in the sidebar and adds a tag', async ({ page }) => {
  await open(page, PM, '/home')
  await expect(taLink(page)).toBeVisible({ timeout: 60_000 })
  await taLink(page).click()
  await expect(page).toHaveURL(/\/admin\/taxonomy$/)
  await expect(page.locator('[data-screen="ta-tag-configuration"]')).toBeVisible()
  await expect(page.locator('[data-guard="pm"]')).toBeVisible()
  await expect(page.locator('[data-current-user]')).toContainText('Pat PM · Project Manager')
  await expect(page.getByText('Oncology')).toBeVisible()
  await page.locator('[data-add-tag]').click()
  await page.locator('[data-input-name]').fill('Cardiology')
  await page.locator('[data-input-abbrev]').fill('CARD')
  await page.locator('[data-save-tag]').click()
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls))
    .toContainEqual({ method: 'POST', path: '/admin/taxonomy/therapeutic-areas', body: { code: 'CARD', label: 'Cardiology' } })
})

test('IT Admin no longer has TA Tags: not in the sidebar, and the page sends them home', async ({ page }) => {
  await open(page, ADMIN, '/admin')
  await expect(page.locator('[data-platform-link="/admin/users"]')).toBeVisible({ timeout: 60_000 })
  await expect(taLink(page)).toHaveCount(0)
  await page.goto('/admin/taxonomy')
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 })
  await expect(page.locator('[data-screen="ta-tag-configuration"]')).toHaveCount(0)
})

test('a Contributor does not see TA Tags', async ({ page }) => {
  await open(page, CON, '/admin/taxonomy')
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 })
  await expect(taLink(page)).toHaveCount(0)
})
