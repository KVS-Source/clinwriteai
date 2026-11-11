// QA regression — Master Library > Master Documents: the item count sits beside the title in brackets
// ("Master Documents (2)"), not in a separate "2 ITEMS · 0 FILTERS APPLIED" pill under the heading. It is the
// library's total (X-Total-Count), not just the rows on this page.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/42-master-documents-count.spec.ts
//
// /auth/me and /library (+ /library/projects) are answered inside the page. Any other API call that comes
// back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ME = { id: 'u-pm-e2e', email: 'pm.e2e@example.com', name: 'Alex Thornton', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const item = (id: string, name: string) => ({
  id, name, module: 'A', itemType: 'document', docType: 'CSR', ta: ['Oncology'], version: '1.0', pushedAt: '2026-11-05T08:00:00Z',
  pushedBy: 'u-pm-e2e', pushedByName: 'Alex Thornton', projectId: 'P1', projectName: 'Final Project', tags: [], isArchived: false,
})

async function open(page: Page, opts: { items: unknown[]; total?: number }) {
  await page.addInitScript(({ me, items, total }) => {
    const real = window.fetch.bind(window)
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (/\/library\/projects(\?.*)?$/.test(url)) return json([{ id: 'P1', name: 'Final Project' }])
      if (/\/library(\?.*)?$/.test(url)) return json(items, { 'X-Total-Count': String(total ?? items.length) })
      const res = await real(input, init)
      return res.status === 401 ? new Response(JSON.stringify({ error: 'e2e_no_session' }), { status: 503 }) : res
    }
  }, { me: ME, items: opts.items, total: opts.total ?? null })
  await page.goto('/master-library/documents')
}

const title = (page: Page) => page.locator('h1', { hasText: 'Master Documents' })

test('the count is beside the title in brackets, and the old pill is gone', async ({ page }) => {
  await open(page, { items: [item('L1', 'CSR Full'), item('L2', 'Protocol')] })
  await expect(title(page)).toHaveText(/^Master Documents\s*\(2\)$/, { timeout: 60_000 })
  await expect(title(page).locator('[data-results-count]')).toHaveText('(2)')
  await expect(page.getByText(/filters applied/i)).toHaveCount(0)
})

test('it shows the library total, not just the rows on this page', async ({ page }) => {
  await open(page, { items: [item('L1', 'CSR Full')], total: 37 })
  await expect(title(page).locator('[data-results-count]')).toHaveText('(37)', { timeout: 60_000 })
})

test('an empty library reads (0)', async ({ page }) => {
  await open(page, { items: [] })
  await expect(title(page).locator('[data-results-count]')).toHaveText('(0)', { timeout: 60_000 })
})

test('the tab strip has no scroll arrows: it never scrolls up and down, and shows no scrollbar', async ({ page }) => {
  await open(page, { items: [item('L1', 'CSR Full'), item('L2', 'Protocol')] })
  const tabs = page.locator('[data-master-library-tabs]')
  await expect(tabs.locator('[data-tab="documents"]')).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })
  const box = await tabs.evaluate(el => {
    const cs = getComputedStyle(el)
    return { overflowY: cs.overflowY, scrollbarWidth: cs.scrollbarWidth, vertical: el.scrollHeight - el.clientHeight, gutter: el.offsetWidth - el.clientWidth }
  })
  expect(box.overflowY).toBe('hidden')
  expect(box.vertical).toBe(0)
  expect(box.gutter).toBe(0)                       // no scrollbar taking room on the side
  // The active tab's underline is still drawn inside the strip.
  const underline = await tabs.locator('[data-tab="documents"]').evaluate(el => getComputedStyle(el, '::after').height)
  expect(underline).toBe('2px')
})
