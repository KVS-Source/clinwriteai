// QA regression — All Stages: column sorting and the document detail side panel.
//
//   E2E_BASE_URL=... E2E_PROJECT_ID=... npx playwright test playwright/smoke/10-document-detail-panel.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
test.setTimeout(120_000)

async function openList(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.waitForSelector('[data-doc-row]', { timeout: 60_000 })
}
const rows = (page: Page) => page.locator('[data-doc-row]')

test('every column header except Quick Actions sorts; a third click restores the natural order', async ({ page }) => {
  await openList(page)
  test.skip((await rows(page).count()) < 2, 'needs at least two documents')
  const titles = async () => rows(page).locator('div:nth-child(1)').allInnerTexts()
  const natural = await titles()

  for (const key of ['title', 'type', 'stage', 'status', 'updated', 'assignee']) {
    await expect(page.locator(`[data-sort="${key}"]`)).toBeVisible()
  }
  await page.locator('[data-sort="title"]').click()
  const asc = await titles()
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })))
  await page.locator('[data-sort="title"]').click()
  expect(await titles()).toEqual([...asc].reverse())
  await page.locator('[data-sort="title"]').click()
  expect(await titles()).toEqual(natural)
})

test('clicking a row opens the detail panel (not the editor); Open goes to the editor', async ({ page }) => {
  await openList(page)
  const panel = page.locator('[data-panel="document-detail"]')
  await rows(page).first().click()
  await expect(panel).toBeVisible()
  expect(page.url()).not.toContain('/documents/')
  await expect(panel.getByText('Source documents')).toBeVisible()
  await panel.locator('[data-action="open-document"]').click()
  await expect(page).toHaveURL(/\/clinical-writing\/documents\//, { timeout: 30_000 })
})

test('Esc, the cross and an outside click close the document panel', async ({ page }) => {
  await openList(page)
  const panel = page.locator('[data-panel="document-detail"]')

  await rows(page).first().click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await rows(page).first().click()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(panel).toHaveCount(0)

  await rows(page).first().click()
  await expect(panel).toBeVisible()
  await page.getByRole('heading', { name: 'Clinical Writing', level: 1 }).click()   // outside the panel
  await expect(panel).toHaveCount(0)
})
