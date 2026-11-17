// QA regression — Master Library > Checklists shows each template once, at its latest version (the highest version
// number, whatever its spelling). Older versions are in the panel's version history. The tab count counts
// templates, not versions.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/47-checklist-latest-version.spec.ts

import { test, expect } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const row = (id: string, deliverableType: string, version: number, templateStatus: string, isCurrent: boolean, legacySpelling = false) =>
  ({ id, deliverableType, storedType: legacySpelling ? deliverableType.replace(/_/g, '-') : deliverableType, legacySpelling, projectId: null, version, templateStatus, isCurrent, itemCount: 3, instanceCount: 0,
     effectiveDate: templateStatus === 'locked' ? '2026-10-16T00:00:00.000Z' : null, createdBy: 'u-pm', createdByName: 'Pat PM', approvedBy: null, approvedByName: null, approvedAt: null, changeReason: null, items: [] })
const LIST = [
  row('csr-old-3', 'csr_full', 3, 'draft', false, true),       // highest number → the one row for CSR (Full)
  row('csr-old-2', 'csr_full', 2, 'locked', true, true),
  row('csr-2', 'csr_full', 2, 'draft', false),
  row('csr-1', 'csr_full', 1, 'locked', true),
  row('dsur-1', 'dsur', 1, 'locked', true),
]

test('one row per checklist at its latest version; older ones in the version history', async ({ page }) => {
  await page.addInitScript(({ me, list }) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/checklist-templates')) return json(list)
      const one = path.match(/\/checklist-templates\/([^/]+)$/)
      if (one) return json(list.find(r => r.id === one[1]))
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: PM, list: LIST })
  await page.goto('/master-library/checklists')
  const rows = page.locator('[data-template-row]')
  await expect(rows).toHaveCount(2, { timeout: 60_000 })
  await expect(page.locator('[data-template-row="csr-old-3"]')).toContainText('v3')
  await expect(page.locator('[data-template-row="csr-old-3"] [data-older-versions]')).toHaveText('+3 older')
  await expect(page.locator('[data-template-row="dsur-1"] [data-older-versions]')).toHaveCount(0)
  await expect(page.locator('[data-tab="checklists"] [data-tab-count]')).toHaveText('(2)')

  await page.locator('[data-template-row="csr-old-3"]').click()
  // The version history is collapsed, and comes after the last stage (Final Output).
  const history = page.locator('[data-template-versions]')
  await expect(history).not.toHaveAttribute('open', '')
  await expect(page.locator('[data-template-version-row]').first()).toBeHidden()
  expect(await history.evaluate(el => { const stages = document.querySelectorAll('[data-stage-group]'); const last = stages[stages.length - 1]; return !!last && !!(last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) })).toBe(true)
  await page.locator('[data-versions-toggle]').click()
  await expect(page.locator('[data-template-version-row]')).toHaveCount(4)
  await page.locator('[data-template-version-row="1"]').last().click()
  await expect(page.locator('[data-template-row="csr-old-3"]')).toHaveAttribute('data-template-active', 'true')   // the list row stays highlighted
})
