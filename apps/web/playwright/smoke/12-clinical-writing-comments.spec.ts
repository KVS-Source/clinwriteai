// QA regression — Clinical Writing home filters and the comments flow.
//
// Read-only: no comment is posted or resolved (any comment write is aborted), so it is
// safe against a shared database. Tests that need comments skip when the project has none.
// The home page loads each document's comments, so the tests keep page loads few to stay
// under the API's per-minute rate limit.
//
//   E2E_BASE_URL=... E2E_PROJECT_ID=... npx playwright test playwright/smoke/12-clinical-writing-comments.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
test.setTimeout(240_000)

// Guard: abort any comment write (post / resolve) that reaches the network.
test.beforeEach(async ({ page }) => {
  await page.route(/\/comments(\/|$|\?)/, route =>
    route.request().method() === 'GET' ? route.continue() : route.abort())
})

const rows = (page: Page) => page.locator('[data-doc-row]')
const listSettled = (page: Page) =>
  rows(page).or(page.getByText('No documents match these filters')).first().waitFor({ timeout: 60_000 })

async function openHome(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await listSettled(page)
  // An empty list with no project header means the requests were refused (the API's per-minute
  // rate limit): wait for the window to pass and load the page once more before trusting it.
  if ((await rows(page).count()) === 0 && (await page.getByText(/^— · —/).count()) > 0) {
    await page.waitForTimeout(61_000)
    await page.reload()
    await listSettled(page)
  }
}

test('home: tab count, search kept in the URL across refresh, Reset filters', async ({ page }) => {
  await openHome(page)
  const total = await rows(page).count()
  await expect(page.getByRole('button', { name: `All Stages (${total})` })).toBeVisible()
  test.skip(total === 0, 'needs at least one document')

  const word = (await rows(page).first().locator(':scope > div').first().innerText()).split(/\s+/)[0]
  await page.getByPlaceholder('Search documents...').fill(word)
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(word)}`))
  await page.reload()
  await expect(page.getByPlaceholder('Search documents...')).toHaveValue(word, { timeout: 60_000 })

  await page.getByRole('button', { name: 'Reset filters' }).first().click()
  await expect(page).not.toHaveURL(/[?&]q=/)
  await expect(rows(page)).toHaveCount(total, { timeout: 30_000 })
})

test('comments: home panel, Editor panel (severity, resolution record, no Reply, note required)', async ({ page }) => {
  await openHome(page)

  // A document with open comments (so the resolve form can be tried), else any with comments.
  const cells = page.locator('[data-comments-cell]')
  test.skip((await cells.count()) === 0, 'needs at least one document')
  await expect(page.locator('[data-comments-cell]', { hasText: '…' })).toHaveCount(0, { timeout: 60_000 })
  const texts = await cells.evaluateAll(els => els.map(e => [e.getAttribute('data-comments-cell'), (e as HTMLElement).innerText]))
  const docId = (texts.find(([, t]) => /\b[1-9]\d*\s*Open/i.test(t ?? '')) ?? texts.find(([, t]) => /\b[1-9]\d*\s*Resolved/i.test(t ?? '')))?.[0] ?? null
  test.skip(!docId, 'needs a document with comments')

  // Home page panel: opens from the cell, not the detail panel; no Resolve here; Esc closes.
  await page.locator(`[data-comments-cell="${docId}"]`).click()
  const panel = page.locator('[aria-label^="Comments for "]').first()
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-panel="document-detail"]')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /^Resolve$/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // "Open at §x" deep-links into the Editor with the Comments panel on that section.
  await page.locator(`[data-comments-cell="${docId}"]`).click()
  const link = panel.getByText(/^Open at §/).first()
  await link.waitFor({ timeout: 15_000 }).catch(() => undefined)
  test.skip((await link.count()) === 0, 'no comment tagged to a section of this document')
  await link.click()
  await expect(page).toHaveURL(/\/documents\//, { timeout: 30_000 })
  await expect(page.locator('[data-comments-scope]')).toBeVisible({ timeout: 90_000 })
  await page.locator('[data-action="toggle-comment-scope"]').click()   // whole document
  await expect(page.locator('[data-comments-scope="document"]')).toBeVisible()

  // Every resolved card shows its resolution record (AC-A-055).
  const resolvedToggle = page.locator('[data-section="resolved"] > button')
  if (await resolvedToggle.count()) {
    if ((await resolvedToggle.getAttribute('aria-expanded')) !== 'true') await resolvedToggle.click()
    const resolved = page.locator('[data-resolved-card]')
    await expect(resolved.first()).toBeVisible()
    await expect(page.locator('[data-resolved-card] [data-resolution]')).toHaveCount(await resolved.count())
  }
  // Every open and resolved card carries a severity pill (FR-A-052).
  const cards = page.locator('[data-comment-id]:not([data-verdict="approve"])')
  await expect(page.locator('[data-comment-id]:not([data-verdict="approve"]) [data-severity]')).toHaveCount(await cards.count())

  // Replies are not in the PRD: no Reply control.
  await expect(page.getByRole('button', { name: /^Reply$/ })).toHaveCount(0)

  // Resolve form: three types; an empty or spaces-only note is refused in the form.
  const resolveBtn = page.locator('[data-action="resolve-comment"]').first()
  test.skip((await resolveBtn.count()) === 0, 'no open comment to try the resolve form on')
  await resolveBtn.click()
  const form = page.locator('[data-resolve-form]')
  await expect(form.getByRole('radio')).toHaveText(['Accept', 'Accept w/ mod', 'Reject'])
  await form.locator('[data-action="confirm-resolve"]').click()
  await expect(form.getByRole('alert')).toHaveText('Resolution note is required')
  await form.locator('input').fill('   ')
  await form.locator('[data-action="confirm-resolve"]').click()
  await expect(form.getByRole('alert')).toHaveText('Resolution note is required')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toHaveCount(0)
})

test('Comments page: no Reply or Reopen; resolved cards show the resolution record', async ({ page }) => {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/comments`)
  const cards = page.locator('[data-comment-id]')
  await cards.first().waitFor({ timeout: 60_000 }).catch(() => undefined)
  test.skip((await cards.count()) === 0, 'needs comments in the project')

  await expect(page.getByRole('button', { name: /^(Reply|Reopen)$/ })).toHaveCount(0)
  const resolved = page.locator('[data-status="resolved"]')
  await expect(page.locator('[data-status="resolved"] [data-resolution]')).toHaveCount(await resolved.count())
})
