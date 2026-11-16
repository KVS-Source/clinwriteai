// QA regression — Master Documents search says why a row is there: a row found only inside the document's text
// shows "Found in text:" with the words around the match, the word marked. Title matches show nothing extra.
// (Which rows match, and in what order, is the API's: apps/api library/routes.test.ts and search.test.ts.)
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/54-master-library-search-match.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, module: 'A', itemType: 'document', docType: 'CSR', ta: ['Oncology'], version: 'v1.0',
  pushedAt: '2026-11-13T09:00:00.000Z', pushedBy: 'u-pm', pushedByName: 'Pat PM', projectId: 'p1', projectName: 'Test tuesday',
  tags: [], isArchived: false, isWithdrawn: false, provenanceChain: [], ...extra,
})

async function open(page: Page, language = 'en') {
  await page.addInitScript(({ me, language, all, searched }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    const w = window as unknown as { __queries: string[] }
    w.__queries = []
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const u = new URL(url, location.origin)
      const p = u.pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      if (/\/library$/.test(p)) {
        const q = u.searchParams.get('q') ?? ''
        w.__queries.push(q)
        const rows = q ? searched : all
        return json(rows, { 'X-Total-Count': String(rows.length), 'X-Next-Cursor': '' })
      }
      if (p.endsWith('/library/count')) return json({ total: all.length })
      return json([])
    }
  }, {
    me: PM, language,
    all: [item('n1', 'test docs'), item('t1', 'CSR'), item('t2', 'Other')],
    searched: [
      item('n1', 'test docs', { searchMatch: 'title' }),
      item('t1', 'CSR', { searchMatch: 'text', matchExcerpt: '…Planned statistical analyses, hypothesis tested, significance level…' }),
    ],
  })
  await page.goto('/master-library/documents')
  await expect(page.locator('[data-library-row]').first()).toBeVisible({ timeout: 60_000 })
}

const row = (page: Page, id: string) => page.locator(`[data-library-row="${id}"]`)

test('a row found only in the text says so, with the words around it and the word marked', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-search-excerpt]')).toHaveCount(0)

  await page.locator('[data-filter-search]').fill('test')
  await expect(page.locator('[data-library-row]')).toHaveCount(2)
  await expect(row(page, 't1').locator('[data-search-excerpt]')).toContainText('Found in text:')
  await expect(row(page, 't1').locator('[data-search-excerpt]')).toContainText('hypothesis tested, significance level')
  await expect(row(page, 't1').locator('[data-search-hit]')).toHaveText(['test'])
  // A title match needs no explanation.
  await expect(row(page, 'n1').locator('[data-search-excerpt]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __queries: string[] }).__queries)).toContain('test')
})

test('the label is Japanese in Japanese', async ({ page }) => {
  await open(page, 'ja')
  await page.locator('[data-filter-search]').fill('test')
  await expect(row(page, 't1').locator('[data-search-excerpt]')).toContainText('本文で一致:')
})
