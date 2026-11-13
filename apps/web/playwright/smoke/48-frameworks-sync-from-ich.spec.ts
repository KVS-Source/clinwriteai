// QA regression — ICH Frameworks: "↻ Sync from ICH" imports the real ICH guideline list from ich.org and the table
// shows it. The import itself (reading ICH's pages, matching rows, skipping working groups) is covered in
// apps/api frameworks/ich-sync.test.ts; here the API is answered inside the page.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/48-frameworks-sync-from-ich.spec.ts

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ADMIN = { id: 'u-admin', email: 'ivy@example.com', name: 'Ivy Admin', role: 'admin', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

async function open(page: Page, syncFails = false) {
  await page.addInitScript(({ me, syncFails }) => {
    const rows: unknown[] = []
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      const m = (init?.method ?? 'GET').toUpperCase()
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/admin/frameworks/sync-ich') && m === 'POST') {
        if (syncFails) return json({ error: 'ich_unreachable', message: 'Could not reach ich.org. Nothing was changed. Try again later.' }, 502)
        rows.push(
          { id: 'f-e3', name: 'ICH E3', description: 'Structure and Content of Clinical Study Reports', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', effectiveDate: '1995-11-30', retiredAt: null, updatedAt: '2026-11-13' },
          { id: 'f-e6', name: 'ICH E6(R3)', description: 'Good Clinical Practice (GCP)', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', effectiveDate: '2025-01-06', retiredAt: null, updatedAt: '2026-11-13' },
        )
        return json({ fetched: 153, created: ['ICH E3', 'ICH E6(R3)'], updated: [], unchanged: 0, withdrawn: [], skipped: [{ code: 'M16 EWG', reason: 'in progress, no step date yet' }] })
      }
      if (path.endsWith('/admin/frameworks')) return json(rows)
      if (path.endsWith('/supersede-requests')) return json([])
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ADMIN, syncFails })
  await page.goto('/master-library/ich-frameworks')
}

test('Sync from ICH fills the table with real ICH guidelines and says what it did', async ({ page }) => {
  await open(page)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-sync-result]')).toContainText('153 ICH entries read, 2 added, 0 updated, 0 unchanged, 1 skipped')
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E6(R3)' })).toContainText('Good Clinical Practice (GCP)')
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E3' })).toContainText('Structure and Content of Clinical Study Reports')
})

test('when ich.org cannot be reached, it says so', async ({ page }) => {
  await open(page, true)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-sync-error]')).toContainText('Could not reach ich.org')
})
