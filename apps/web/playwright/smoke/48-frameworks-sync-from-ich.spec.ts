// QA regression — ICH Frameworks: "↻ Sync from ICH" imports the real ICH guideline list from ich.org and the table
// shows it. The import itself (reading ICH's pages, matching rows, skipping working groups) is covered in
// apps/api frameworks/ich-sync.test.ts; here the API is answered inside the page.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/48-frameworks-sync-from-ich.spec.ts

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'ivy@example.com', name: 'Ivy PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const QC = { ...PM, id: 'u-qc', name: 'Quinn QC', role: 'qc' }

async function open(page: Page, syncFails = false, me: typeof PM = PM) {
  await page.addInitScript(({ me, syncFails }) => {
    const rows: unknown[] = []
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      const m = (init?.method ?? 'GET').toUpperCase()
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/admin/frameworks/sync-ich/status')) {
        return json(rows.length
          ? { lastSyncedAt: new Date().toISOString(), lastTrigger: 'manual', autoSync: { enabled: true, everyDays: 30 } }
          : { lastSyncedAt: '2026-11-16T06:30:00.000Z', lastTrigger: 'automatic', autoSync: { enabled: true, everyDays: 30 } })
      }
      if (path.endsWith('/admin/frameworks/sync-ich') && m === 'POST') {
        if (syncFails) return json({ error: 'ich_unreachable', message: 'Could not reach ich.org. Nothing was changed. Try again later.' }, 502)
        rows.push(
          { id: 'f-e3', name: 'ICH E3', description: 'Structure and Content of Clinical Study Reports', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', scope: ['A', 'B', 'C', 'D', 'E'], effectiveDate: '1995-11-30', retiredAt: null, updatedAt: '2026-11-13' },
          { id: 'f-e6', name: 'ICH E6(R3)', description: 'Good Clinical Practice (GCP)', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', scope: ['D'], effectiveDate: '2025-01-06', retiredAt: null, updatedAt: '2026-11-13' },
        )
        return json({ fetched: 153, created: ['ICH E3', 'ICH E6(R3)'], updated: [], unchanged: 0, withdrawn: [], skipped: [{ code: 'M16 EWG', reason: 'in progress, no step date yet' }] })
      }
      const patch = path.match(/\/admin\/frameworks\/([^/]+)$/)
      if (patch && m === 'PATCH') { const r = rows.find(x => (x as { id: string }).id === patch[1]) as Record<string, unknown>; Object.assign(r, JSON.parse(String(init!.body))); return json(r) }
      if (path.endsWith('/admin/frameworks')) return json(rows)
      if (path.endsWith('/supersede-requests')) return json([])
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me, syncFails })
  await page.goto('/master-library/ich-frameworks')
}

test('Sync from ICH fills the table with real ICH guidelines and says what it did', async ({ page }) => {
  await open(page)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-sync-result]')).toContainText('153 ICH entries read, 2 added, 0 updated, 0 unchanged, 1 skipped')
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E6(R3)' })).toContainText('Good Clinical Practice (GCP)')
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E3' })).toContainText('Structure and Content of Clinical Study Reports')
})

test('shows when the registry last synced from ICH and that it syncs by itself every 30 days, with the next date', async ({ page }) => {
  await open(page)
  const status = page.locator('[data-ich-sync-status]')
  await expect(status).toContainText('Last synced from ICH', { timeout: 60_000 })
  await expect(status).toContainText('(automatic)')
  await expect(status).toContainText('automatically every 30 days')
  // Last sync 16 Nov 2026 + 30 days.
  await expect(status.locator('[data-next-auto-sync]')).toContainText('Dec 16, 2026')
  await page.locator('[data-action="sync-ich"]').click()
  await expect(status).not.toContainText('(automatic)')            // a manual sync replaces it
})

test('when ich.org cannot be reached, it says so', async ({ page }) => {
  await open(page, true)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-sync-error]')).toContainText('Could not reach ich.org')
})

test('Scope shows the modules a framework applies to, and a Project Manager can change it', async ({ page }) => {
  await open(page)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  const e6 = page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E6(R3)' })
  await expect(e6.locator('[data-scope-dot]')).toHaveCount(1)
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E3' }).locator('[data-scope-dot]')).toHaveCount(5)
  await e6.click()
  await expect(page.locator('[data-scope-check="D"]')).toBeChecked()
  await page.locator('[data-scope-check="A"]').check()
  await expect(e6.locator('[data-scope-dot]')).toHaveCount(2)
})

test('the scope colour key sits beside the search field, and the status chip stays on one line', async ({ page }) => {
  await open(page)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  const key = page.locator('[data-scope-legend] [data-scope-legend-item]')
  await expect(key).toHaveText(['AClinical', 'BScientific', 'CMedical', 'DRegulatory', 'EIdeation & Publishing'])
  await expect(key.first()).toHaveAttribute('title', 'Clinical Writing')
  const chip = page.locator('[data-status-chip="Current"]').first()
  await expect(chip).toHaveText('Current')
  expect((await chip.boundingBox())!.height).toBeLessThan(26)          // one line
  await page.screenshot({ path: 'test-results/frameworks-toolbar.png' })
  await page.setViewportSize({ width: 1700, height: 720 })
  await page.screenshot({ path: 'test-results/frameworks-toolbar-wide.png' })
})

// Since 8ff2cb00 the Master Library shows a non-PM only Master Documents and Best Practices: a QC never reaches the
// frameworks page, so never gets its Sync or Add buttons.
test('a QC does not get the ICH Frameworks page, Sync from ICH or + Add framework', async ({ page }) => {
  await open(page, false, QC)
  await expect(page.getByRole('heading', { name: 'Master Documents' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-screen="regulatory-framework-admin"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /ICH Frameworks/ })).toHaveCount(0)
  await expect(page.locator('[data-action="sync-ich"]')).toHaveCount(0)
  await expect(page.locator('[data-add-framework]')).toHaveCount(0)
})

test('Cancel clears the Add framework form, so reopening it starts empty', async ({ page }) => {
  await open(page)
  await page.locator('[data-add-framework]').click({ timeout: 60_000 })
  const form = page.locator('[data-add-framework-form]')
  await form.locator('[data-input-code]').fill('ICHT1')
  await form.locator('[data-input-name]').fill('CSR')
  await form.locator('[data-input-issuer]').fill('ICH')
  await form.locator('[data-input-source-url]').fill('https://example.org/x')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.locator('[data-add-framework]').click()
  for (const f of ['code', 'name', 'issuer', 'version', 'source-url']) await expect(form.locator(`[data-input-${f}]`)).toHaveValue('')
  await expect(form.locator('[role="alert"]')).toHaveCount(0)
})

test('Cancel in a framework panel closes it, even when nothing was changed', async ({ page }) => {
  await open(page)
  await page.locator('[data-action="sync-ich"]').click({ timeout: 60_000 })
  await page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICH E3' }).click()
  const cancel = page.locator('[data-cancel-framework]')
  await expect(cancel).toBeVisible()
  await expect(page.locator('[data-scope-checkboxes]')).toBeVisible()
  // QA: an ICH guideline has no approval step; its status follows ich.org.
  await expect(page.locator('[data-ich-status-note]')).toContainText('follows ich.org')
  await expect(page.locator('[data-status-select]')).toHaveCount(0)
  await expect(page.locator('[data-save-framework]')).toHaveCount(0)
  await cancel.click()
  await expect(page.locator('[data-scope-checkboxes]')).toBeHidden()
})
