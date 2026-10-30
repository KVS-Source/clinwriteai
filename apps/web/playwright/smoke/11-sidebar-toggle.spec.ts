// QA regression — left navigation panel arrow.
//
// Inside a document the left nav shrinks to an icon rail — every document opens that way. An arrow button on the rail's edge
// opens the full panel (all modules) and collapses it again; on other pages the panel starts open and
// the same arrow collapses it.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/11-sidebar-toggle.spec.ts
//
// The document is answered inside the page (no database writes), as in 09-source-references.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const DOC_ID = 'DOC-E2E-SIDEBAR'

test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ docId, projectId }) => {
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const m = new RegExp(`/documents/${docId}(/[^?]*)?(\\?.*)?$`).exec(url)
      if (!m) return real(input, init)
      const sub = m[1] ?? ''
      if (sub === '') return json({ id: docId, projectId, type: 'csr-full', title: 'E2E Sidebar CSR', status: 'in-authoring', stage: 'post-study', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-22T09:00:00Z', sections: [{ id: 's1', number: '§1', title: 'Title Page', status: 'in-progress', contentHtml: '<p>Hello</p>' }] })
      if (sub === '/references') return json({ projectId, items: [] })
      if (sub.includes('presence')) return json({ documentId: docId, sections: [] })
      return json(sub === '/versions' || sub.endsWith('s') ? [] : {})
    }
  }, { docId: DOC_ID, projectId: PROJECT_ID })
})

const sidebar = (page: Page) => page.locator('aside[data-collapsed], aside').first()
const toggle = (page: Page) => page.locator('[data-sidebar-toggle]')
const width = async (page: Page) => (await sidebar(page).boundingBox())!.width

async function openEditor(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/documents/${DOC_ID}`)
  await expect(page.locator('[data-section-content]')).toBeVisible({ timeout: 60_000 })
}

test('in the editor the nav is an icon rail with an arrow that opens the full panel and closes it again', async ({ page }) => {
  await openEditor(page)

  // rail: narrow, the arrow offers to open it
  await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true')
  await expect.poll(() => width(page)).toBeLessThan(80)
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Open navigation panel')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText(/switch module/i)).toBeHidden()

  // open: full width, all modules listed, editor still there
  await toggle(page).click()
  await expect(sidebar(page)).not.toHaveAttribute('data-collapsed', /.*/)
  await expect.poll(() => width(page)).toBeGreaterThan(200)
  await expect(page.getByText(/switch module/i)).toBeVisible()
  for (const name of ['Clinical Writing', 'Scientific Writing', 'Medical Writing', 'Regulatory Writing', 'Ideation & Publishing']) {
    await expect(sidebar(page).getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Collapse navigation panel')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-section-content]')).toBeVisible()

  // close again
  await toggle(page).click()
  await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true')
  await expect.poll(() => width(page)).toBeLessThan(80)
})

test('every document opens collapsed (also after a reload), and the arrow works from the keyboard', async ({ page }) => {
  await openEditor(page)
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')

  await toggle(page).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => width(page)).toBeGreaterThan(200)

  // stays open across the document's own tabs
  await page.getByRole('link', { name: 'Version Diff' }).click()
  await expect.poll(() => width(page)).toBeGreaterThan(200)

  // reopening the document starts collapsed again
  await page.reload()
  await expect.poll(() => width(page)).toBeLessThan(80)
})

test('on a normal page the panel starts open and the same arrow collapses it', async ({ page }) => {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await expect(toggle(page)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => width(page)).toBeGreaterThan(200)
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Collapse navigation panel')

  await toggle(page).click()
  await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true')
  await expect.poll(() => width(page)).toBeLessThan(80)
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Open navigation panel')

  await toggle(page).click()
  await expect.poll(() => width(page)).toBeGreaterThan(200)
})

test('the rail shows module badges, hover labels and a toggle under the logo', async ({ page }) => {
  await openEditor(page)
  if ((await toggle(page).getAttribute('aria-expanded')) === 'true') await toggle(page).click()   // make sure we are on the rail
  await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true')

  // one badge per module, current one marked
  for (const [key, mono] of [['clinical-writing', 'CW'], ['scientific-writing', 'SW'], ['medical-writing', 'MW'], ['regulatory-writing', 'RW'], ['ideation-publishing', 'IP']] as const) {
    await expect(page.locator(`[data-module-switch="${key}"]`)).toHaveText(mono)
  }
  await expect(page.locator('[data-module-switch="clinical-writing"]')).toHaveAttribute('aria-current', 'true')

  // hovering an icon names it
  await page.getByRole('link', { name: 'All Projects' }).hover()
  await expect(page.locator('[data-rail-tip]')).toHaveText('All Projects')
  await page.mouse.move(700, 400)
  await expect(page.locator('[data-rail-tip]')).toHaveCount(0)

  // keyboard focus shows the label too
  await page.locator('[data-module-switch="scientific-writing"]').focus()
  await expect(page.locator('[data-rail-tip]')).toContainText('Scientific Writing')

  // the toggle sits at the top of the rail, inside the viewport, and is labelled on hover
  const box = (await toggle(page).boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await toggle(page).hover()
  await expect(page.locator('[data-rail-tip]')).toContainText('Open navigation panel')
})

test('on a short window the toggle is still reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await openEditor(page)
  if ((await toggle(page).getAttribute('aria-expanded')) === 'false') await toggle(page).click()   // expanded = tallest content
  await expect(toggle(page)).toBeInViewport()
  await toggle(page).click()
  await expect(toggle(page)).toBeInViewport()
})
