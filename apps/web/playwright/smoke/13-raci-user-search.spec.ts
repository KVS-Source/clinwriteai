// QA regression — the RACI user search lists no one until something is typed.
//
// Each RACI letter has a "Filter users" box. With the box empty no user list is shown; from the first letter
// it lists only the users whose name or email matches; clearing the box hides the list again.
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
  await page.addInitScript(({ users, persona }) => {
    // Admins can't open projects, so run as a PM, and answer that this user may edit the RACI.
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/documents\/[^/]+\/raci\/can-edit/.test(url)) return json({ canEdit: true })
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json(users)
      if (/\/documents\/[^/?]+\/raci(\?.*)?$/.test(url) && method === 'GET') return json([])
      return real(input, init)
    }
  }, { users: USERS, persona: process.env.E2E_PM_PERSONA ?? 'user-sa' })
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

test('no list while empty; matches from the first letter; clearing hides the list again', async ({ page }) => {
  await openRaci(page)
  const box = page.getByLabel('Filter users').first()
  const picker = box.locator('xpath=..')
  const results = picker.locator('[data-user-results]')
  const letterNames = (n: string) => picker.getByText(n, { exact: true })

  // empty box: no list
  await expect(results).toHaveCount(0)
  await expect(letterNames('Sarah Chen')).toHaveCount(0)

  // first letter: matches only (name or email containing "i" — Sarah's has none)
  await box.fill('i')
  await expect(results).toBeVisible()
  await expect(letterNames('Samir Patel')).toBeVisible()
  await expect(letterNames('Maria Lopez')).toBeVisible()
  await expect(letterNames('Sarah Chen')).toHaveCount(0)

  // narrowing as more is typed
  await box.fill('sa')
  await expect(letterNames('Sarah Chen')).toBeVisible()
  await expect(letterNames('Samir Patel')).toBeVisible()
  await expect(letterNames('Maria Lopez')).toHaveCount(0)
  await box.fill('sar')
  await expect(letterNames('Sarah Chen')).toBeVisible()
  await expect(letterNames('Samir Patel')).toHaveCount(0)

  // also matches e-mail, and a miss says so
  await box.fill('lopez@')
  await expect(letterNames('Maria Lopez')).toBeVisible()
  await box.fill('zzz')
  await expect(picker.getByText('No matches.')).toBeVisible()

  // only spaces is still empty, and clearing hides the list again
  await box.fill('   ')
  await expect(results).toHaveCount(0)
  await box.fill('')
  await expect(results).toHaveCount(0)
})
