// QA regression — Audit Trail search applies itself while typing.
//
// Defect: typing in the Audit Trail "Search" box did nothing until the user
// clicked Apply. The box now applies its term after a short pause in typing
// (debounced), without sending a request per keystroke.
//
// Asserts on the outgoing request rather than on table rows, so it holds
// regardless of what audit data exists or whether the current user may read it.
//
//   E2E_BASE_URL=https://demo.clinwrite.ai npx playwright test playwright/smoke/08-audit-trail-search.spec.ts

import { test, expect, type Request } from '@playwright/test'
import { ensureLoggedIn } from '../helpers/auth'

const isAuditList = (r: Request) => /\/admin\/audit\?/.test(r.url())
const searchTerm = (r: Request) => new URL(r.url()).searchParams.get('q')

test('Audit Trail search runs automatically without clicking Apply', async ({ page }) => {
  const sent: Array<string | null> = []
  page.on('request', r => { if (isAuditList(r)) sent.push(searchTerm(r)) })

  // Wait for the DOM, not the full load event — the dev server serves hundreds
  // of modules and can exceed the default navigation timeout.
  await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' })
  const box = page.locator('[data-field="search"]')
  const signIn = page.getByRole('heading', { name: /sign in to your account/i })
  await expect(box.or(signIn)).toBeVisible({ timeout: 30_000 })

  // Production builds enforce sign-in (rendered in place of the page). Walk it
  // via /sign-in, then return through the sidebar — a full reload would drop
  // the in-memory session.
  if (await signIn.isVisible()) {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
    await ensureLoggedIn(page)
    await page.locator('[data-platform-link="/admin/audit"]').click({ timeout: 30_000 })
    await expect(box).toBeVisible({ timeout: 30_000 })
  }

  const searched = page.waitForRequest(r => isAuditList(r) && searchTerm(r) === 'rohan', { timeout: 10_000 })
  await box.pressSequentially('rohan', { delay: 60 })   // type like a user; Apply is never clicked
  await searched

  // Debounced: partial terms ("r", "ro", …) are never sent.
  expect(sent.filter(q => q !== null && q !== 'rohan')).toEqual([])

  // Clearing the box re-runs the list without a search term.
  const cleared = page.waitForRequest(r => isAuditList(r) && searchTerm(r) === null, { timeout: 10_000 })
  await box.fill('')
  await cleared
})
