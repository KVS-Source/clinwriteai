// QA regression — All Stages "⋯" row menu: RACI only for documents that are being worked on.
//
// RACI is listed for In Authoring, In Review and CRM In Progress; it is not listed for any other status
// (Not Started, Pending Signature, Signed). Choosing it opens the RACI drawer for that document.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/15-row-menu-raci.spec.ts
//
// The project's document list (and the RACI rows) are answered inside the page; nothing is written.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
test.setTimeout(120_000)

const STATUSES = ['in-authoring', 'in-review', 'crm-in-progress', 'not-started', 'pending-signature', 'signed'] as const
const WITH_RACI = new Set<string>(['in-authoring', 'in-review', 'crm-in-progress'])
const docId = (s: string) => `DOC-E2E-MENU-${s}`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ projectId, statuses }) => {
    const docs = statuses.map((status, i) => ({
      id: `DOC-E2E-MENU-${status}`, projectId, type: 'protocol', title: `Menu test ${status}`, status,
      stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1',
      updatedAt: `2026-10-2${i}T09:00:00Z`, sections: [],
    }))
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') return json(docs)
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json([])
      if (/\/documents\/DOC-E2E-MENU-[^/?]+\/raci(\?.*)?$/.test(url) && method === 'GET') return json([])
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, statuses: [...STATUSES] })
})

async function openMenu(page: Page, status: string) {
  const row = page.locator(`[data-doc-row="${docId(status)}"]`)
  await row.getByRole('button', { name: 'More actions' }).click()
  const menu = page.locator('[data-row-menu]')
  await expect(menu).toBeVisible()
  return menu
}

test('RACI appears in the row menu only for In Authoring, In Review and CRM In Progress', async ({ page }) => {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await expect(page.locator(`[data-doc-row="${docId('in-authoring')}"]`)).toBeVisible({ timeout: 60_000 })

  for (const status of STATUSES) {
    const menu = await openMenu(page, status)
    const raci = menu.getByRole('menuitem', { name: 'RACI', exact: true }).or(menu.getByRole('button', { name: 'RACI', exact: true }))
    if (WITH_RACI.has(status)) await expect(raci, `RACI for ${status}`).toBeVisible()
    else await expect(raci, `no RACI for ${status}`).toHaveCount(0)
    await expect(menu.getByText('Audit trail')).toBeVisible()          // the rest of the menu is unchanged
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
})

test('choosing RACI opens the RACI drawer for that document', async ({ page }) => {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await expect(page.locator(`[data-doc-row="${docId('crm-in-progress')}"]`)).toBeVisible({ timeout: 60_000 })
  const menu = await openMenu(page, 'crm-in-progress')
  await menu.getByText('RACI', { exact: true }).click()
  await expect(page.getByText('RACI — Menu test crm-in-progress')).toBeVisible()
  await expect(page.getByLabel('Filter users').first()).toBeVisible({ timeout: 30_000 })
})
