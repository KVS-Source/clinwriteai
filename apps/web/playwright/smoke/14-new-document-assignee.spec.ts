// QA regression — New Document: the "Assigned writer" dropdown is filled for people who are not admins.
//
// The tenant user list (/admin/users) is admin-only and answers 403 to everyone else; the dropdown used to
// depend on it, so a writer or project manager saw an empty list. It now lists the project's members.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/14-new-document-assignee.spec.ts
//
// The user lists and the source library are answered inside the page; nothing is created.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)

const MEMBERS = [
  { id: 'u-sarah', name: 'Sarah Chen',  email: 'sarah.chen@example.com',  initials: 'SC', capabilities: ['can-author'], projectRole: 'Clinical Writer' },
  { id: 'u-omar',  name: 'Omar Reyes',  email: 'omar.reyes@example.com',  initials: 'OR', capabilities: [],             projectRole: 'Medical Writer' },
  { id: 'u-rita',  name: 'Rita Okafor', email: 'rita.okafor@example.com', initials: 'RO', capabilities: ['can-review'], projectRole: 'Reviewer' },
  { id: 'u-priya', name: 'Priya Nair',  email: 'priya.nair@example.com',  initials: 'PN', capabilities: ['can-author'], projectRole: null },
]
const SOURCE = { id: 'up-1', title: 'Protocol v3', fileName: 'protocol.pdf', fileSizeBytes: 1000, contentType: 'application/pdf', previewable: true, category: 'protocol', categorySource: 'set', origin: null, version: null, state: 'saved', virusScanStatus: 'passed', usedIn: [], uploadedBy: { id: 'u-sarah', name: 'Sarah Chen', email: null }, uploadedAt: '2026-10-20T09:00:00Z' }

async function stub(page: Page, adminListStatus: number) {
  await page.addInitScript(({ members, source, adminStatus, persona }) => {
    // Only a project manager is offered New Document.
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json(members)
      if (/\/admin\/users(\?.*)?$/.test(url)) return adminStatus === 200 ? json([]) : json({ error: 'forbidden' }, adminStatus)
      if (/\/projects\/[^/]+\/source-documents(\?.*)?$/.test(url)) return json({ items: [source], total: 1, page: 1, pageSize: 100, summary: { files: 1, saved: 1, rejected: 0 } })
      return real(input, init)
    }
  }, { members: MEMBERS, source: SOURCE, adminStatus: adminListStatus, persona: PM_PERSONA })
}

async function toDetails(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.getByRole('button', { name: /New Document/ }).first().click()
  await expect(page.locator('[data-form="new-document"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-action="wizard-next"]').dispatchEvent('click')                       // type -> sources
  await page.locator(`[data-source-id="${SOURCE.id}"]`).check()
  await page.locator('[data-action="wizard-next"]').dispatchEvent('click')                       // sources -> details
  await expect(page.locator('[data-step-body="details"]')).toBeVisible()
}

test('a non-admin (admin user list answers 403) still gets project writers in the assignee dropdown', async ({ page }) => {
  await stub(page, 403)
  await toDetails(page)
  const field = page.locator('[data-step-body="details"] [data-field="assignee"] input')
  await expect(field).toHaveAttribute('placeholder', /select an assignee/i)

  await field.click()
  const options = page.locator('[data-field="assignee"] [role="option"]')
  await expect(options).toHaveCount(3)
  await expect(options.filter({ hasText: 'Sarah Chen (Clinical Writer)' })).toHaveCount(1)
  const omar = options.filter({ hasText: 'Omar Reyes (Medical Writer)' })
  await expect(omar).toHaveCount(1)                                                         // no recorded capabilities: listed, but not eligible (CW-081)
  await expect(omar).toHaveAttribute('data-ineligible', '')
  await expect(omar).toContainText('Not eligible')
  await expect(options.filter({ hasText: 'Rita Okafor' })).toHaveCount(0)                   // reviewer-only, cannot author
  await expect(options.filter({ hasText: 'Priya Nair' })).toContainText('Priya Nair')
  await expect(options.filter({ hasText: 'Priya Nair' })).not.toContainText('(')            // no project role, nothing in brackets

  await omar.click({ force: true })                                                         // an ineligible person can't be picked (force: Playwright won't click aria-disabled)
  await expect(field).toHaveValue('')
  await options.filter({ hasText: 'Sarah Chen' }).click()
  await expect(field).toHaveValue('Sarah Chen')
})

test('the assignee list narrows by name or email, and works from the keyboard', async ({ page }) => {
  await stub(page, 403)
  await toDetails(page)
  const field = page.locator('[data-step-body="details"] [data-field="assignee"] input')
  const options = page.locator('[data-field="assignee"] [role="option"]')

  await field.fill('omar')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText('Omar Reyes')

  await field.fill('priya.nair@')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText('Priya Nair')

  await field.fill('nobody')
  await expect(options).toHaveCount(0)
  await expect(page.locator('[data-field="assignee"]')).toContainText('No matches')

  await field.fill('')
  await field.press('ArrowDown')
  await field.press('Enter')
  await expect(field).toHaveValue('')                                                       // Omar (second row) is not eligible: Enter picks nobody
  await field.press('ArrowDown')
  await field.press('Enter')
  await expect(field).toHaveValue('Priya Nair')
  await expect(page.locator('[data-step-body="details"]')).toBeVisible()                    // Enter chose a person, it did not submit

  await field.click()
  await field.fill('sarah')
  await field.press('Escape')
  await expect(options).toHaveCount(0)
  await expect(field).toHaveValue('Priya Nair')                                             // abandoning a search keeps the choice
})
