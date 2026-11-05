// QA regression — Reviewers (C) and QC (Q) mark their part done in Reviewer View, and everyone sees who has.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJ-X/DOC-ID \
//     npx playwright test playwright/smoke/28-review-completion.spec.ts
//
// The document's status, its RACI rows and the completion are answered inside the page, and presence pings
// are absorbed; nothing is written. The real server rules are in document-raci/complete-review.test.ts.

import { test, expect, type Page } from '@playwright/test'

const DOC = process.env.E2E_DOC
const ME = process.env.E2E_CONTRIBUTOR_PERSONA ?? 'cmv7x2f920001gtoivawht3vn'
test.setTimeout(120_000)
test.skip(!DOC, 'set E2E_DOC to PROJECT/DOCUMENT')

const row = (id: string, userId: string, userName: string, letter: string, over: Record<string, unknown> = {}) => ({
  id, documentId: 'd', userId, userName, letter, sectionId: null, approvalOrder: null, signatureRequired: false, signatureMeaning: null,
  submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, assignedBy: 'x', assignedAt: '2026-11-01T00:00:00Z', removedAt: null, ...over,
})

type Rows = ReturnType<typeof row>[]

async function open(page: Page, rows: Rows, opts: { status?: string; refuse?: boolean; movesOn?: boolean } = {}) {
  const [projectId, documentId] = DOC!.split('/')
  await page.addInitScript(({ rows, persona, documentId, status, refuse, movesOn }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const state = { rows: rows as Array<Record<string, unknown>>, status, calls: [] as string[] }
    ;(window as unknown as { __review: typeof state }).__review = state
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const done = new RegExp(`/documents/${documentId}/raci/([^/]+)/complete`).exec(url)
      if (done && method === 'POST') {
        state.calls.push(done[1]!)
        if (refuse) return json({ error: 'not_in_review', message: 'Review can only be marked done while the document is in review.' }, 409)
        const target = state.rows.find(r => r.id === done[1])!
        target.reviewedAt = '2026-11-04T10:00:00Z'
        const open = state.rows.filter(r => (r.letter === 'C' || r.letter === 'Q') && !r.reviewedAt).length
        if (open === 0 && movesOn) state.status = 'pending-signature'
        return json({ row: target, transition: { cohortComplete: open === 0, cohortDone: 0, cohortTotal: 0, gatingLetter: 'C', nextStatus: null, rejectedRows: 0 }, transitioned: open === 0 && !!movesOn })
      }
      if (new RegExp(`/documents/${documentId}/raci(\\?.*)?$`).test(url) && method === 'GET') return json(state.rows)
      if (new RegExp(`/documents/${documentId}(\\?.*)?$`).test(url) && method === 'GET') {
        const res = await real(input, init)
        return json({ ...(await res.json()), status: state.status })
      }
      if (url.includes('/presence') && method !== 'GET') return json({})
      return real(input, init)
    }
  }, { rows, persona: ME, documentId, status: opts.status ?? 'in-review', refuse: !!opts.refuse, movesOn: !!opts.movesOn })
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-open-comments]')).toBeVisible({ timeout: 60_000 })
}

const bar = (page: Page) => page.locator('[data-review-completion]')
const action = (page: Page) => page.locator('[data-action="complete-review"]')
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __review: { calls: string[] } }).__review.calls)

test('a reviewer confirms, is marked done, and the progress updates', async ({ page }) => {
  await open(page, [row('c1', ME, 'Me', 'C'), row('q1', 'u-q', 'Quinn', 'Q')])
  await expect(bar(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-review-progress]')).toContainText('0 of 2')
  await expect(page.locator('[data-review-person="u-q"]')).toHaveAttribute('data-review-state', 'pending')
  await expect(action(page)).toHaveText('Mark review done')

  // Cancel changes nothing.
  await action(page).click()
  await page.locator('[data-action="cancel-complete-review"]').click()
  expect(await calls(page)).toEqual([])

  await action(page).click()
  await page.locator('[data-action="confirm-complete-review"]').click()
  await expect(page.locator(`[data-review-person="${ME}"]`)).toHaveAttribute('data-review-state', 'done')
  await expect(page.locator('[data-review-progress]')).toContainText('1 of 2')
  await expect(action(page)).toHaveCount(0)
  await expect(page.locator('[data-review-all-done]')).toHaveCount(0)
  expect(await calls(page)).toEqual(['c1'])
})

test('QC gets its own label, and the last person finishing is told what happens next', async ({ page }) => {
  await open(page, [row('c1', 'u-c', 'Cora', 'C', { reviewedAt: '2026-11-03T09:00:00Z' }), row('q1', ME, 'Me', 'Q')])
  await expect(action(page)).toHaveText('QC Complete', { timeout: 30_000 })
  await action(page).click()
  await page.locator('[data-action="confirm-complete-review"]').click()
  await expect(page.locator('[data-review-all-done]')).toBeVisible()
  await expect(page.locator('[data-review-progress]')).toContainText('2 of 2')
})

test('when the last completion moves the document on, its status refreshes and the page follows', async ({ page }) => {
  await open(page, [row('c1', ME, 'Me', 'C')], { status: 'crm-in-progress', movesOn: true })
  await action(page).click({ timeout: 30_000 })
  await page.locator('[data-action="confirm-complete-review"]').click()
  await expect(page).toHaveURL(/\/sign$/, { timeout: 30_000 })
})

test('someone not reviewing sees who has finished, but no button', async ({ page }) => {
  await open(page, [row('c1', 'u-c', 'Cora', 'C', { reviewedAt: '2026-11-03T09:00:00Z' }), row('q1', 'u-q', 'Quinn', 'Q'), row('i1', ME, 'Me', 'I')])
  await expect(page.locator('[data-review-person="u-c"]')).toHaveAttribute('data-review-state', 'done', { timeout: 30_000 })
  await expect(page.locator('[data-review-person="u-q"]')).toHaveAttribute('data-review-state', 'pending')
  await expect(page.locator(`[data-review-person="${ME}"]`)).toHaveCount(0)
  await expect(action(page)).toHaveCount(0)
})

test('a part requiring a signature says so instead of failing', async ({ page }) => {
  await open(page, [row('c1', ME, 'Me', 'C', { signatureRequired: true, signatureMeaning: 'Medical approval' })])
  await expect(action(page)).toBeDisabled({ timeout: 30_000 })
  await expect(page.locator('[data-review-needs-signature]')).toBeVisible()
})

test('a refusal from the server is shown, and nothing changes', async ({ page }) => {
  await open(page, [row('c1', ME, 'Me', 'C')], { refuse: true })
  await action(page).click({ timeout: 30_000 })
  await page.locator('[data-action="confirm-complete-review"]').click()
  await expect(page.locator('[data-review-complete-error]')).toContainText('only be marked done')
  await expect(page.locator(`[data-review-person="${ME}"]`)).toHaveAttribute('data-review-state', 'pending')
})

test('the bar stays away before review starts', async ({ page }) => {
  await open(page, [row('c1', ME, 'Me', 'C')], { status: 'in-authoring' })
  await expect(page.locator('[data-notice="not-submitted"]')).toBeVisible({ timeout: 30_000 })
  await expect(bar(page)).toHaveCount(0)
})
