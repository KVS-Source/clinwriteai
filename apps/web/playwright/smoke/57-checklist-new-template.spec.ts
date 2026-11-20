// Master Library > Checklists: a PM starts a new checklist template from the "+ New checklist template" button,
// importing its items from a CSV (e.g. a spreadsheet kept on the shared drive, saved as CSV). Bad rows are listed
// and block the create; a good file sends every row; the new draft opens in the panel. Other roles get no button.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/57-checklist-new-template.spec.ts

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const DSUR = { id: 'dsur-1', deliverableType: 'dsur', storedType: 'dsur', legacySpelling: false, projectId: null, version: 1, templateStatus: 'locked', isCurrent: true, itemCount: 0, instanceCount: 0,
  effectiveDate: '2026-10-16T00:00:00.000Z', createdBy: 'u-pm', createdByName: 'Pat PM', approvedBy: null, approvedByName: null, approvedAt: null, changeReason: null, items: [], canEdit: true, canApprove: false }

async function mock(page: Page, me: typeof PM) {
  await page.addInitScript(({ me, dsur }) => {
    const w = window as unknown as { __created?: unknown }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      const method = (init?.method ?? 'GET').toUpperCase()
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/checklist-templates') && method === 'POST') {
        w.__created = JSON.parse(String(init?.body))
        return json({ id: 'new-1', version: 1, templateStatus: 'draft' }, 201)
      }
      const created = w.__created as { deliverableType: string; items: unknown[] } | undefined
      const newRow = created && { ...dsur, id: 'new-1', deliverableType: created.deliverableType, storedType: created.deliverableType, templateStatus: 'draft', isCurrent: false, effectiveDate: null,
        items: created.items.map((it, i) => ({ id: `i${i}`, sortOrder: (i + 1) * 10, ...(it as object) })) }
      if (path.endsWith('/checklist-templates')) return json(newRow ? [dsur, newRow] : [dsur])
      const one = path.match(/\/checklist-templates\/([^/]+)$/)
      if (one) return json(one[1] === 'new-1' ? newRow : dsur)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me, dsur: DSUR })
}

const GOOD = 'Item,Framework,Mandatory,Owner,Stage\n"Synopsis matches, word for word",ICH E3,Yes,R,Post-Study\nQC of tables,SOP-QC-01,No,Q,Cross-Functional Review\n'
const BAD = 'Item,Framework,Stage\nSynopsis present,ICH E3,Somewhere\n'

test('a PM creates a new checklist template from a CSV and the draft opens', async ({ page }) => {
  await mock(page, PM)
  await page.goto('/master-library/checklists')
  await page.locator('[data-action="new-checklist-template"]').click({ timeout: 60_000 })
  const dialog = page.locator('[data-dialog="new-checklist-template"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-action="confirm-new-template"]')).toBeDisabled()      // no deliverable yet

  await dialog.locator('[data-field="deliverable-type"]').selectOption('csr_synopsis')
  await dialog.locator('[data-field="items-file"]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(BAD) })
  await expect(dialog.locator('[data-import-errors]')).toContainText('Row 2: unknown stage "Somewhere"')
  await expect(dialog.locator('[data-action="confirm-new-template"]')).toBeDisabled()      // a bad file blocks the create

  await dialog.locator('[data-field="items-file"]').setInputFiles({ name: 'checklist.csv', mimeType: 'text/csv', buffer: Buffer.from(GOOD) })
  await expect(dialog.locator('[data-import-ok]')).toContainText('2 items ready from checklist.csv')
  await dialog.locator('[data-action="confirm-new-template"]').click()

  await expect(dialog).toBeHidden()
  const sent = await page.evaluate(() => (window as unknown as { __created: unknown }).__created)
  expect(sent).toMatchObject({
    deliverableType: 'csr_synopsis',
    items: [
      { text: 'Synopsis matches, word for word', framework: 'ICH E3', frameworkMandatory: true, ownerRaci: 'R', stage: 'reporting' },
      { text: 'QC of tables', framework: 'SOP-QC-01', frameworkMandatory: false, ownerRaci: 'Q', stage: 'cross_functional_review' },
    ],
  })
  await expect(page.getByText('Synopsis matches, word for word')).toBeVisible()           // the new draft is open in the panel
})

test('a Contributor gets no New checklist template button', async ({ page }) => {
  await mock(page, { ...PM, id: 'u-c', name: 'Abhi Contributor', role: 'contributor' })
  await page.goto('/master-library/checklists')
  await expect(page.locator('[data-template-row]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-action="new-checklist-template"]')).toHaveCount(0)
})
