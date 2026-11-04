// QA regression — the PM's project status control, on the dashboard and in Project Settings.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-X \
//     npx playwright test playwright/smoke/29-project-status.spec.ts
//
// The project's status, documents and transition are answered inside the page, so nothing is written.
// The real server rules are in apps/api/src/modules/projects/project-status.test.ts.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM = process.env.E2E_PM_PERSONA ?? 'user-sa'
const CONTRIBUTOR = process.env.E2E_CONTRIBUTOR_PERSONA ?? 'cmv7x2f920001gtoivawht3vn'
test.setTimeout(120_000)

const NEXT: Record<string, string[]> = {
  initiated: ['ongoing', 'on-hold', 'closed'], ongoing: ['on-hold', 'closed'], 'on-hold': ['ongoing', 'closed'], closed: ['re-open'], 're-open': ['ongoing', 'on-hold', 'closed'],
}

async function open(page: Page, opts: { status?: string; docs?: string[]; persona?: string; refuse?: boolean; path?: string } = {}) {
  await page.addInitScript(({ projectId, status, docs, persona, next, refuse }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const state = { status, history: [] as unknown[], sent: [] as unknown[] }
    ;(window as unknown as { __status: typeof state }).__status = state
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes(`/projects/${projectId}/status`)) return json({ status: state.status, next: (next as Record<string, string[]>)[state.status], history: state.history })
      if (url.includes(`/projects/${projectId}/transition`)) {
        const body = JSON.parse(String(init?.body)) as { to: string; reason: string }
        state.sent.push(body)
        if (refuse) return json({ error: 'invalid_transition', message: 'Invalid project transition: someone else moved it first.' }, 409)
        state.history = [{ id: String(state.history.length + 1), at: '2026-11-04T10:00:00.000Z', by: 'Alex Thornton', from: state.status, to: body.to, reason: body.reason }, ...state.history]
        state.status = body.to
        return json({ id: projectId, status: body.to })
      }
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') {
        return json((docs as string[]).map((s, i) => ({ id: `D${i}`, projectId, type: 'protocol', title: `Doc ${i}`, status: s, stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', sections: [] })))
      }
      if (new RegExp(`/projects/${projectId}(\\?.*)?$`).test(url) && method === 'GET') {
        const res = await real(input, init)
        return json({ ...(await res.json()), status: state.status, shortTitle: 'Test Alpha' })
      }
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, status: opts.status ?? 'ongoing', docs: opts.docs ?? [], persona: opts.persona ?? PM, next: NEXT, refuse: !!opts.refuse })
  await page.goto(`/projects/${PROJECT_ID}${opts.path ?? ''}`, { waitUntil: 'domcontentloaded' })
}

const menu = (page: Page) => page.locator('[data-action="change-project-status"]')
const option = (page: Page, to: string) => page.locator(`[data-status-option="${to}"]`)
const confirm = (page: Page) => page.locator('[data-action="confirm-status-change"]')
const reason = (page: Page) => page.locator('[data-field="status-reason"]')
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __status: { sent: unknown[] } }).__status.sent)

test('the menu offers only valid next moves', async ({ page }) => {
  await open(page, { status: 'closed' })
  await menu(page).click({ timeout: 60_000 })
  await expect(page.locator('[data-status-option]')).toHaveCount(1)
  await expect(option(page, 're-open')).toBeVisible()
})

test('an ordinary change needs a reason, and shows up in the status and history', async ({ page }) => {
  await open(page)
  await menu(page).click({ timeout: 60_000 })
  await expect(page.locator('[data-status-option]')).toHaveCount(2)
  await option(page, 'on-hold').click()

  await expect(confirm(page)).toBeDisabled()
  await reason(page).fill('   ')
  await expect(confirm(page)).toBeDisabled()
  await expect(page.locator('[data-field="status-confirm"]')).toHaveCount(0)
  await reason(page).fill('Sponsor paused the study')
  await confirm(page).click()

  await expect(page.locator('[data-project-status-dialog]')).toHaveCount(0)
  expect(await sent(page)).toEqual([{ to: 'on-hold', reason: 'Sponsor paused the study' }])
  await page.locator('[data-action="toggle-status-history"]').click()
  await expect(page.locator('[data-status-history]')).toContainText('Sponsor paused the study')
  await expect(page.locator('[data-status-history]')).toContainText('Alex Thornton')
  await menu(page).click()
  await expect(option(page, 'ongoing')).toBeVisible()
})

test('Close warns about unsigned documents, and needs the project name typed', async ({ page }) => {
  await open(page, { docs: ['signed', 'in-review', 'in-authoring'] })
  await menu(page).click({ timeout: 60_000 })
  await option(page, 'closed').click()
  await expect(page.locator('[data-status-warning]')).toContainText('stops document editing')
  await expect(page.locator('[data-status-unsigned]')).toContainText('2 documents')

  await reason(page).fill('Study complete')
  await expect(confirm(page)).toBeDisabled()
  await page.locator('[data-field="status-confirm"]').fill('wrong name')
  await expect(confirm(page)).toBeDisabled()
  await page.locator('[data-field="status-confirm"]').fill('test alpha')
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()
  await expect(page.locator('[data-project-status-dialog]')).toHaveCount(0)
  expect(await sent(page)).toEqual([{ to: 'closed', reason: 'Study complete' }])
})

test('Re-open also asks for the stronger confirm', async ({ page }) => {
  await open(page, { status: 'closed' })
  await menu(page).click({ timeout: 60_000 })
  await option(page, 're-open').click()
  await reason(page).fill('New data arrived')
  await expect(confirm(page)).toBeDisabled()
  await page.locator('[data-field="status-confirm"]').fill('Test Alpha')
  await expect(confirm(page)).toBeEnabled()
})

test('Cancel changes nothing, and a refusal keeps the dialog open with the reason', async ({ page }) => {
  await open(page, { refuse: true })
  await menu(page).click({ timeout: 60_000 })
  await option(page, 'on-hold').click()
  await page.locator('[data-action="cancel-status-change"]').click()
  expect(await sent(page)).toEqual([])

  await menu(page).click()
  await option(page, 'on-hold').click()
  await reason(page).fill('Paused')
  await confirm(page).click()
  await expect(page.locator('[data-status-error]')).toContainText('someone else moved it')
  await expect(reason(page)).toHaveValue('Paused')
})

test('a suggestion only opens the dialog, and can be dismissed', async ({ page }) => {
  await open(page, { status: 'initiated', docs: ['in-authoring'] })
  const banner = page.locator('[data-status-suggestion="ongoing"]')
  await expect(banner).toBeVisible({ timeout: 60_000 })
  expect(await sent(page)).toEqual([])

  await page.locator('[data-action="apply-status-suggestion"]').click()
  await expect(page.locator('[data-project-status-dialog="ongoing"]')).toBeVisible()
  expect(await sent(page)).toEqual([])
  await page.locator('[data-action="cancel-status-change"]').click()

  await page.locator('[data-action="dismiss-status-suggestion"]').click()
  await expect(banner).toHaveCount(0)
})

test('all documents signed suggests closing; a project with nothing to suggest stays quiet', async ({ page }) => {
  await open(page, { docs: ['signed', 'signed'] })
  await expect(page.locator('[data-status-suggestion="closed"]')).toBeVisible({ timeout: 60_000 })
})

test('Project Settings gives the PM the control and history, with the team read-only', async ({ page }) => {
  await open(page, { path: '/settings' })
  await expect(page.locator('[data-section="project-status"]')).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.locator('[data-status-history-empty]')).toBeVisible()
  await expect(page.locator('[data-action="add-member"]')).toHaveCount(0)
  await menu(page).click()
  await option(page, 'on-hold').click()
  await reason(page).fill('Paused from settings')
  await confirm(page).click()
  await expect(page.locator('[data-status-history]')).toContainText('Paused from settings')
})

test('someone who is not the PM gets no control', async ({ page }) => {
  await open(page, { persona: CONTRIBUTOR })
  await expect(page.locator('[data-screen="project-dashboard"]')).toBeVisible({ timeout: 60_000 })
  await expect(menu(page)).toHaveCount(0)
  await expect(page.locator('[data-action="toggle-status-history"]')).toHaveCount(0)
})
