// QA regression — a second Project Manager assigned to a document as Approver (A) only saw Version Diff, Approver
// View, E-Signature and Final Document. A PM keeps the Editor and CRM tabs; a non-PM Approver still doesn't get them.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/54-pm-approver-tabs.spec.ts

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const DOC = 'doc-e2e-1'
const BASE = `/projects/p-e2e/clinical-writing/documents/${DOC}`
const PM2 = { id: 'u-pm2', email: 'pm2@example.com', name: 'Abhi PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const APPROVER = { ...PM2, id: 'u-appr', name: 'Alex Approver', role: 'contributor' }

async function open(page: Page, me: typeof PM2, path = '/diff') {
  await page.addInitScript(({ me, doc }) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.endsWith('/auth/me')) return json(me)
      if (p.endsWith(`/documents/${doc}/raci`)) {
        return json([{ id: 'r-a', documentId: doc, userId: me.id, letter: 'A', sectionId: null, approvalOrder: 1, signatureRequired: true, signatureMeaning: null, submittedAt: null, reviewedAt: null, removedAt: null }])
      }
      // No CRM meetings: an Approver-only person isn't invited to one, so has no CRM tab.
      if (p.endsWith(`/documents/${doc}/crm`)) return json([])
      if (p.endsWith(`/documents/${doc}`)) return json({ id: doc, projectId: 'p-e2e', title: 'CSR Full', documentType: 'csr_full', status: 'in-review', version: '0.1', sections: [] })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me, doc: DOC })
  await page.goto(`${BASE}${path}`)
}

const tab = (page: Page, label: string) => page.locator(`[data-subnav] [data-subnav-tab="${label}"]`)

test('a PM assigned as Approver gets the Editor and CRM tabs and Reviewer View, never Approver View', async ({ page }) => {
  await open(page, PM2)
  await expect(tab(page, 'Reviewer View')).toBeVisible({ timeout: 60_000 })
  await expect(tab(page, 'Approver View')).toHaveCount(0)
  await expect(tab(page, 'Editor')).toBeVisible()
  await expect(tab(page, 'CRM')).toBeVisible()
  await expect(tab(page, 'E-Signature')).toBeVisible()
  await expect(tab(page, 'Final Document')).toBeVisible()
})

test('a deep link to CRM is not sent away for a PM Approver', async ({ page }) => {
  await open(page, PM2, '/crm')
  await expect(tab(page, 'CRM')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  expect(new URL(page.url()).pathname).toBe(`${BASE}/crm`)
})

// Contributor + Project Manager (e.g. Abhishek, Sheetal): the tabs follow the role chosen in the top bar.
test('a Contributor + PM working as Project Manager gets the Editor and CRM tabs and Reviewer View, not Approver View', async ({ page }) => {
  const me = { ...PM2, id: 'u-dual', name: 'Dual Role', role: 'pm', roles: ['pm'], allRoles: ['contributor', 'pm'] }
  await page.addInitScript((id) => { localStorage.setItem('clinwrite.activeRole', JSON.stringify({ userId: id, role: 'pm' })) }, me.id)
  await open(page, me)
  await expect(tab(page, 'Reviewer View')).toBeVisible({ timeout: 60_000 })
  await expect(tab(page, 'Approver View')).toHaveCount(0)
  await expect(tab(page, 'Editor')).toBeVisible()
  await expect(tab(page, 'CRM')).toBeVisible()
  // No "Accountable (Approver)" chip in the header while working as PM.
  await expect(page.locator('[data-my-raci-role]')).toHaveCount(0)
})

test('the same user still working as Contributor does not (switching to Project Manager gives them)', async ({ page }) => {
  const me = { ...PM2, id: 'u-dual', name: 'Dual Role', role: 'contributor', roles: ['contributor'], allRoles: ['contributor', 'pm'] }
  await page.addInitScript((id) => { localStorage.setItem('clinwrite.activeRole', JSON.stringify({ userId: id, role: 'contributor' })) }, me.id)
  await open(page, me)
  await expect(tab(page, 'Approver View')).toBeVisible({ timeout: 60_000 })
  await expect(tab(page, 'Editor')).toHaveCount(0)
  await expect(tab(page, 'CRM')).toHaveCount(0)
  await expect(page.locator('[data-my-raci-role]')).toContainText('Accountable (Approver)')
})

test('an Approver who is not a PM still has no Editor or CRM tab', async ({ page }) => {
  await open(page, APPROVER)
  await expect(tab(page, 'Approver View')).toBeVisible({ timeout: 60_000 })
  await expect(tab(page, 'Editor')).toHaveCount(0)
  await expect(tab(page, 'CRM')).toHaveCount(0)
})
