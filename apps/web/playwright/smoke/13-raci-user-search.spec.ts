// QA regression — the RACI user search only filters from 3 characters.
//
// Each RACI letter has a "Filter users" box. One or two characters must not narrow the list (a hint asks for
// 3), three or more filter by name or email, and clearing the box brings everyone back.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/13-raci-user-search.spec.ts
//
// The RACI rows and candidate users are answered inside the page; nothing is written.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID

test.setTimeout(120_000)

const USERS = [
  { id: 'u-sarah', name: 'Sarah Chen',   email: 'sarah.chen@example.com',   initials: 'SC', capabilities: [], projectRole: null },
  { id: 'u-samir', name: 'Samir Patel',  email: 'samir.patel@example.com',  initials: 'SP', capabilities: [], projectRole: null },
  { id: 'u-maria', name: 'Maria Lopez',  email: 'maria.lopez@example.com',  initials: 'ML', capabilities: [], projectRole: null },
]

test.beforeEach(async ({ page }) => {
  // Only the RACI rows and the candidate users are answered here; the document list is real (read-only).
  await page.addInitScript(({ users }) => {
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json(users)
      if (/\/documents\/[^/?]+\/raci(\?.*)?$/.test(url) && method === 'GET') return json([])
      return real(input, init)
    }
  }, { users: USERS })
})

async function openRaci(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.waitForSelector('[data-doc-row]', { timeout: 60_000 })
  // pick a document that is not signed (signed documents hide the RACI shortcut)
  const rows = page.locator('[data-doc-row]')
  const n = await rows.count()
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click()
    const btn = page.locator('[data-action="open-raci"]')
    if (await btn.isVisible().catch(() => false)) { await btn.click(); break }
  }
  await expect(page.getByLabel('Filter users').first()).toBeVisible({ timeout: 30_000 })
}

const names = (page: Page) => page.getByText(/^(Sarah Chen|Samir Patel|Maria Lopez)$/)

test('1-2 characters do not filter and show a hint; 3+ characters filter; clearing restores everyone', async ({ page }) => {
  await openRaci(page)
  const box = page.getByLabel('Filter users').first()
  const picker = box.locator('xpath=..')
  const letterNames = (n: string) => picker.getByText(n, { exact: true })

  await expect(letterNames('Sarah Chen')).toBeVisible()
  await expect(picker.locator('[data-search-hint]')).toHaveCount(0)

  // one and two characters: everyone still listed, hint shown
  await box.fill('s')
  await expect(picker.locator('[data-search-hint]')).toContainText('at least 3 characters')
  for (const n of ['Sarah Chen', 'Samir Patel', 'Maria Lopez']) await expect(letterNames(n)).toBeVisible()
  await box.fill('sa')
  await expect(picker.locator('[data-search-hint]')).toBeVisible()
  await expect(letterNames('Maria Lopez')).toBeVisible()

  // three characters: filters, hint gone
  await box.fill('sar')
  await expect(picker.locator('[data-search-hint]')).toHaveCount(0)
  await expect(letterNames('Sarah Chen')).toBeVisible()
  await expect(letterNames('Samir Patel')).toBeHidden()
  await expect(letterNames('Maria Lopez')).toBeHidden()

  // also matches e-mail, and a miss says so
  await box.fill('lopez@')
  await expect(letterNames('Maria Lopez')).toBeVisible()
  await box.fill('zzz')
  await expect(picker.getByText('No matches.')).toBeVisible()

  // spaces don't count toward the 3, and clearing restores the list
  await box.fill('  s ')
  await expect(picker.locator('[data-search-hint]')).toBeVisible()
  await box.fill('')
  await expect(picker.locator('[data-search-hint]')).toHaveCount(0)
  await expect(letterNames('Samir Patel')).toBeVisible()
  expect(await names(page).count()).toBeGreaterThanOrEqual(3)
})
