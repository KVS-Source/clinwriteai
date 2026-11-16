// QA regression — the TA Tags table has the same controls as the other tables: a search (tag name or
// abbreviation), Status and In use filters with a reset, sortable columns, and paging.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/50-ta-tags-table-controls.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

// 25 tags: the first three named, the rest filler. Two are archived, three are unused.
function rows() {
  const named = [
    { code: 'ONC', label: 'Oncology',      status: 'active',   projectCount: 8, documentCount: 50, createdAt: '2026-10-06T09:00:00.000Z' },
    { code: 'CARD', label: 'Cardiovascular', status: 'active', projectCount: 2, documentCount: 7,  createdAt: '2026-10-07T09:00:00.000Z' },
    { code: 'ZOO', label: 'Zoonoses',      status: 'archived', projectCount: 0, documentCount: 0,  createdAt: '2026-10-08T09:00:00.000Z' },
  ]
  const filler = Array.from({ length: 22 }, (_, i) => ({
    code: `T${String(i).padStart(2, '0')}`, label: `Tag ${String(i).padStart(2, '0')}`,
    status: i === 0 ? 'archived' : 'active',
    projectCount: i < 2 ? 0 : 1, documentCount: i < 2 ? 0 : 1,
    createdAt: `2026-11-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
  }))
  return [...named, ...filler].map(r => ({ ...r, parentCode: null, createdBy: 'u-pm', archivedAt: null }))
}

async function open(page: Page) {
  await page.addInitScript(({ me, rows }) => {
    localStorage.setItem('clinwrite.uiLanguage', 'en')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      if (path.startsWith('/src/') || path.startsWith('/node_modules/') || path.startsWith('/@')) return real(input, init)
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/taxonomy/therapeutic-areas')) return json(rows)
      return json([])
    }
  }, { me: PM, rows: rows() })
  await page.goto('/admin/taxonomy')
  await expect(page.locator('[data-tag-row]').first()).toBeVisible({ timeout: 60_000 })
}

const names = (page: Page) => page.locator('[data-tag-row] td:first-child').allTextContents()
const pageStatus = (page: Page) => page.locator('[data-page-status]')

test('a search finds tags by name or abbreviation', async ({ page }) => {
  await open(page)
  await page.locator('[data-filter-search]').fill('onco')
  expect(await names(page)).toEqual(['Oncology'])
  await page.locator('[data-filter-search]').fill('card')
  expect(await names(page)).toEqual(['Cardiovascular'])
  await page.locator('[data-filter-search]').fill('nothing like this')
  await expect(page.locator('[data-state="empty"]')).toContainText('No tags match these filters.')
  await page.locator('[data-state="empty"] button').click()
  await expect(pageStatus(page)).toContainText('25')
})

test('Status and In use filter the list, and reset clears them', async ({ page }) => {
  await open(page)
  await page.locator('[data-filter-status] button').first().click()
  await page.locator('input[data-status-option="archived"]').click()
  await page.keyboard.press('Escape')
  expect((await names(page)).sort()).toEqual(['Tag 00', 'Zoonoses'])

  await page.locator('[data-action="reset-filters"]').click()
  await page.locator('[data-filter-in-use] button').first().click()
  await page.locator('input[data-in-use-option="unused"]').click()
  await page.keyboard.press('Escape')
  expect((await names(page)).sort()).toEqual(['Tag 00', 'Tag 01', 'Zoonoses'])

  await page.locator('[data-action="reset-filters"]').click()
  await expect(page.locator('[data-action="reset-filters"]')).toBeDisabled()
  await expect(pageStatus(page)).toContainText('25')
})

test('the columns sort both ways', async ({ page }) => {
  await open(page)
  await page.locator('[data-sort="name-asc"]').click()
  expect((await names(page))[0]).toBe('Cardiovascular')
  await page.locator('[data-sort="name-asc"]').click()
  expect((await names(page))[0]).toBe('Zoonoses')
  await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1)

  await page.locator('[data-sort="use-asc"]').click()
  await page.locator('[data-sort="use-asc"]').click()
  expect((await names(page))[0]).toBe('Oncology')
})

test('20 rows to a page, with Next and a choice of page size', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-tag-row]')).toHaveCount(20)
  await page.locator('[data-action="next-page"]').click()
  await expect(page.locator('[data-tag-row]')).toHaveCount(5)
  await page.locator('[data-page-size]').selectOption('50')
  await expect(page.locator('[data-tag-row]')).toHaveCount(25)
})

test('the search box and both filters show real words, not translation keys', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-filter-search]')).toHaveAttribute('placeholder', 'Search by tag name or abbreviation')
  await expect(page.locator('[data-filter-status] button').first()).toHaveText(/All statuses/)
  await expect(page.locator('[data-filter-in-use] button').first()).toHaveText(/Any usage/)
  await expect(page.locator('[data-filter-panel]')).not.toContainText('page.ta_tag')
})

test('Add tag opens a non-modal panel that can be resized and closed', async ({ page }) => {
  await open(page)
  await page.locator('[data-add-tag]').click()
  const panel = page.locator('[data-slide-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-modal', 'false')
  await expect(panel).toContainText('Add therapeutic area tag')

  // Clicks inside it keep it open.
  await page.locator('[data-input-name]').click()
  await page.locator('[data-input-name]').fill('Half typed')
  await expect(panel).toBeVisible()

  // Drag the left edge to widen it.
  const before = (await panel.boundingBox())!.width
  const grip = (await panel.locator('[role="separator"]').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 150, grip.y + grip.height / 2, { steps: 5 })
  await page.mouse.up()
  expect((await panel.boundingBox())!.width).toBeGreaterThan(before + 100)

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('a click anywhere outside the Add tag panel closes it, and the page carries on', async ({ page }) => {
  await open(page)
  const panel = page.locator('[data-slide-panel]')

  await page.locator('[data-add-tag]').click()
  await expect(panel).toBeVisible()
  await page.locator('[data-tag-row]').first().locator('td').first().click()
  await expect(panel).toHaveCount(0)

  // Non-modal: the click that closed it also reached the page, so the search takes the focus and the text.
  await page.locator('[data-add-tag]').click()
  await expect(panel).toBeVisible()
  await page.locator('[data-filter-search]').click()
  await expect(panel).toHaveCount(0)
  await page.locator('[data-filter-search]').fill('onco')
  expect(await names(page)).toEqual(['Oncology'])
})
