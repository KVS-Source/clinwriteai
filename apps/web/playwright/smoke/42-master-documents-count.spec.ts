// QA regression — Master Library tabs show how many items each holds, beside the tab name
// ("Master Documents (2)", "Templates (4)"…), and the Master Documents title carries no count (nor the old
// "2 ITEMS · 0 FILTERS APPLIED" pill). Master Documents counts the library's total (X-Total-Count), not just
// the rows on the current page. A tab whose list can't be read shows no count. The tab strip has no scroll
// arrows.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/42-master-documents-count.spec.ts
//
// /auth/me, every tab's list endpoint, /library/count (the Master Documents count) and /library/enabled-modules
// (Best Practices counts only enabled modules) are answered inside the page. Any other API call that comes back
// 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ME = { id: 'u-pm-e2e', email: 'pm.e2e@example.com', name: 'Alex Thornton', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const item = (id: string, name: string) => ({
  id, name, module: 'A', itemType: 'document', docType: 'CSR', ta: ['Oncology'], version: '1.0', pushedAt: '2026-11-05T08:00:00Z',
  pushedBy: 'u-pm-e2e', pushedByName: 'Alex Thornton', projectId: 'P1', projectName: 'Final Project', tags: [], isArchived: false,
})
const many = (n: number, f: (i: number) => object) => Array.from({ length: n }, (_, i) => f(i))

type Lists = { library?: unknown[]; libraryTotal?: number; bestPractices?: unknown[]; templates?: unknown[]; policies?: unknown[]; checklists?: unknown[] | 'forbidden'; frameworks?: unknown[] }

const DEFAULT_LISTS: Lists = {
  library: [item('L1', 'CSR Full'), item('L2', 'Protocol')],
  bestPractices: many(3, i => ({ id: `bp-${i}`, title: `BP ${i}`, module: 'A' })),
  templates: many(4, i => ({ id: `tpl-${i}`, type: `type-${i}`, label: `Template ${i}`, framework: 'ICH E3', version: 1, sections: [], updatedAt: '2026-10-29T00:00:00Z' })),
  policies: many(1, i => ({ id: `pol-${i}`, docType: 'CSR', smePrompt: '' })),
  checklists: many(5, i => ({ id: `chk-${i}`, deliverableType: 'CSR', projectId: null, version: i + 1, templateStatus: 'locked', itemCount: 3, instanceCount: 0 })),
  frameworks: many(6, i => ({ id: `fw-${i}`, name: `ICH E${i}`, description: '', jurisdiction: 'ICH', version: '1', effectiveDate: '2020-01-01', retiredAt: null, updatedAt: '2026-01-01' })),
}

async function open(page: Page, overrides: Lists = {}, path = '/master-library/documents') {
  const lists = { ...DEFAULT_LISTS, ...overrides }
  await page.addInitScript(({ me, lists }) => {
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, window.location.origin).pathname
      if (/\/auth\/me$/.test(path)) return json(me)
      if (/\/library\/projects$/.test(path)) return json([{ id: 'P1', name: 'Final Project' }])
      if (/\/library\/count$/.test(path)) return json({ total: lists.libraryTotal ?? (lists.library as unknown[]).length })
      if (/\/library\/enabled-modules$/.test(path)) return json({ modules: ['A', 'B', 'C', 'D', 'E'] })
      if (/\/library\/best-practices$/.test(path)) return json(lists.bestPractices)
      if (/\/library$/.test(path)) return json(lists.library, 200, { 'X-Total-Count': String(lists.libraryTotal ?? (lists.library as unknown[]).length) })
      if (/\/document-templates$/.test(path)) return json(lists.templates)
      if (/\/document-type-policies$/.test(path)) return json({ policies: lists.policies })
      if (/\/checklist-templates$/.test(path)) return lists.checklists === 'forbidden' ? json({ error: 'forbidden' }, 403) : json(lists.checklists)
      if (/\/admin\/frameworks$/.test(path)) return json(lists.frameworks)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ME, lists })
  await page.goto(path)
}

const tab = (page: Page, slug: string) => page.locator(`[data-master-library-tabs] [data-tab="${slug}"]`)

test('every tab shows its count beside its name', async ({ page }) => {
  await open(page)
  const expected: Array<[string, string]> = [
    ['documents', 'Master Documents (2)'],
    ['best-practices', 'Best Practices (3)'],
    ['templates', 'Templates (4)'],
    ['ai-prompts', 'AI Prompts (1)'],
    ['checklists', 'Checklists (5)'],
    ['ich-frameworks', 'ICH Frameworks (6)'],
    ['policies', 'Doc Type Policies (1)'],
  ]
  for (const [slug, text] of expected) {
    await expect(tab(page, slug)).toHaveText(text, { timeout: 60_000 })
  }
})

test('the Master Documents title has no count, and the old pill is gone', async ({ page }) => {
  await open(page)
  await expect(tab(page, 'documents')).toHaveText('Master Documents (2)', { timeout: 60_000 })
  await expect(page.locator('h1', { hasText: 'Master Documents' })).toHaveText('Master Documents')
  await expect(page.getByText(/filters applied/i)).toHaveCount(0)
})

test('Master Documents counts the library total, not just the rows on this page; empty reads (0)', async ({ page }) => {
  await open(page, { library: [item('L1', 'CSR Full')], libraryTotal: 37, templates: [] })
  await expect(tab(page, 'documents')).toHaveText('Master Documents (37)', { timeout: 60_000 })
  await expect(tab(page, 'templates')).toHaveText('Templates (0)')
})

test('a tab whose list cannot be read shows no count', async ({ page }) => {
  await open(page, { checklists: 'forbidden' })
  await expect(tab(page, 'templates')).toHaveText('Templates (4)', { timeout: 60_000 })
  await expect(tab(page, 'checklists')).toHaveText('Checklists')
  await expect(tab(page, 'checklists').locator('[data-tab-count]')).toHaveCount(0)
})

test('the counts stay as you move between tabs', async ({ page }) => {
  await open(page, {}, '/master-library/templates')
  await expect(tab(page, 'templates')).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })
  await expect(tab(page, 'templates')).toHaveText('Templates (4)')
  await tab(page, 'ich-frameworks').click()
  await expect(tab(page, 'ich-frameworks')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'ich-frameworks')).toHaveText('ICH Frameworks (6)')
  await expect(tab(page, 'documents')).toHaveText('Master Documents (2)')
})

test('the tab strip has no scroll arrows: it never scrolls up and down, and shows no scrollbar', async ({ page }) => {
  await open(page)
  const tabs = page.locator('[data-master-library-tabs]')
  await expect(tab(page, 'documents')).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })
  await expect(tab(page, 'documents')).toHaveText('Master Documents (2)')
  const box = await tabs.evaluate(el => {
    const cs = getComputedStyle(el)
    return { overflowY: cs.overflowY, vertical: el.scrollHeight - el.clientHeight, gutter: el.offsetWidth - el.clientWidth }
  })
  expect(box.overflowY).toBe('hidden')
  expect(box.vertical).toBe(0)
  expect(box.gutter).toBe(0)                       // no scrollbar taking room on the side
  // The active tab's underline is still drawn inside the strip.
  const underline = await tab(page, 'documents').evaluate(el => getComputedStyle(el, '::after').height)
  expect(underline).toBe('2px')
})

// The right-hand panel has no Expand button on Checklists (nor on ICH Frameworks or AI Prompts, which never
// had one); it can still be resized by dragging its edge. Templates keeps its Expand button.
const expandButton = (page: Page) => page.getByRole('button', { name: /^(Expand|Shrink) panel$/ })

test('the Checklists panel has no Expand button', async ({ page }) => {
  await open(page, {}, '/master-library/checklists')
  await page.locator('[data-template-row="chk-0"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-slide-panel], [role="dialog"]').first()).toBeVisible()
  await expect(expandButton(page)).toHaveCount(0)
})

test('the ICH Frameworks panel has no Expand button', async ({ page }) => {
  await open(page, {}, '/master-library/ich-frameworks')
  await page.locator('[data-frameworks-table] tbody tr').first().click({ timeout: 60_000 })
  await expect(page.locator('[data-edit-drawer]')).toBeVisible()
  await expect(expandButton(page)).toHaveCount(0)
})

test('the Templates panel keeps its Expand button', async ({ page }) => {
  await open(page, {}, '/master-library/templates')
  await page.locator('[data-template-id="tpl-0"]').click({ timeout: 60_000 })
  await expect(expandButton(page)).toHaveCount(1)
})
