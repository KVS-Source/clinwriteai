// QA regression — changing a document's deadlines after creation, and seeing them on the dashboard.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-X \
//     npx playwright test playwright/smoke/30-deadlines.spec.ts
//
// The documents, the access answer and the saves are answered inside the page; nothing is written.
// The real server rules are in apps/api/src/modules/clinical-writing/documents/deadlines.test.ts.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM = process.env.E2E_PM_PERSONA ?? 'user-sa'
const DOC = 'DOC-E2E-DATES'
const NEXT_YEAR = new Date().getFullYear() + 1
const LATER = `${NEXT_YEAR}-06-20`
test.setTimeout(120_000)

type Stub = {
  canEditTarget?: boolean
  canEditReviewDue?: boolean
  target?: string | null
  reviewDue?: string | null
  status?: string
  refuse?: boolean
  extraDocs?: Array<Record<string, unknown>>
}

async function stub(page: Page, opts: Stub) {
  await page.addInitScript(({ projectId, doc, persona, opts }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const state = {
      target: opts.target ?? null, reviewDue: opts.reviewDue ?? null,
      sent: [] as Array<{ url: string; body: unknown }>,
    }
    ;(window as unknown as { __dates: typeof state }).__dates = state
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && method === 'GET') {
        return json([
          { id: doc, projectId, type: 'protocol', title: 'Dates test', status: opts.status ?? 'in-review', stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', targetCompletionDate: state.target, reviewDueAt: state.reviewDue, sections: [] },
          ...(opts.extraDocs ?? []),
        ])
      }
      if (url.includes(`/documents/${doc}/deadlines/access`)) return json({ canEditTarget: !!opts.canEditTarget, canEditReviewDue: !!opts.canEditReviewDue })
      if (method === 'PATCH' && (url.includes(`/documents/${doc}/target-date`) || url.includes(`/documents/${doc}/review-due-date`))) {
        const body = JSON.parse(String(init?.body)) as { date: string | null }
        state.sent.push({ url: new URL(url, window.location.href).pathname.split('/').pop()!, body })
        if (opts.refuse) return json({ error: 'deadline_locked', message: "This document's dates can't be changed because it is signed or its project is closed." }, 409)
        const iso = body.date ? `${body.date}T00:00:00.000Z` : null
        if (url.includes('target-date')) state.target = iso
        else state.reviewDue = iso
        return json({})
      }
      if (url.includes(`/documents/${doc}/raci`)) return json([])
      if (url.includes(`/documents/${doc}/`)) return json({})
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, doc: DOC, persona: PM, opts })
}

async function openPanel(page: Page, opts: Stub) {
  await stub(page, opts)
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`, { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  await expect(page.locator('[data-panel="document-detail"]')).toBeVisible()
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __dates: { sent: unknown[] } }).__dates.sent)
const field = (page: Page, name: string) => page.locator(`[data-deadline="${name}"]`)

test('the PM edits the target date; the panel shows it straight away, and Cancel changes nothing', async ({ page }) => {
  await openPanel(page, { canEditTarget: true, target: `${NEXT_YEAR}-01-10T00:00:00.000Z`, reviewDue: `${NEXT_YEAR}-02-10T00:00:00.000Z` })
  await expect(field(page, 'target-date').locator('[data-deadline-value]')).toContainText(`10 Jan ${NEXT_YEAR}`)
  await expect(page.locator('[data-action="edit-review-due"]')).toHaveCount(0)

  await page.locator('[data-action="edit-target-date"]').click()
  await page.locator('[data-field="target-date-input"]').fill(LATER)
  await page.locator('[data-action="cancel-target-date"]').click()
  expect(await sent(page)).toEqual([])

  await page.locator('[data-action="edit-target-date"]').click()
  await page.locator('[data-field="target-date-input"]').fill(LATER)
  await page.locator('[data-action="save-target-date"]').click()
  await expect(field(page, 'target-date').locator('[data-deadline-value]')).toContainText(`20 Jun ${NEXT_YEAR}`)
  expect(await sent(page)).toEqual([{ url: 'target-date', body: { date: LATER } }])
})

test('the PM can clear the target date', async ({ page }) => {
  await openPanel(page, { canEditTarget: true, target: `${NEXT_YEAR}-01-10T00:00:00.000Z` })
  await page.locator('[data-action="edit-target-date"]').click()
  await page.locator('[data-action="clear-target-date"]').click()
  await expect(field(page, 'target-date').locator('[data-deadline-value]')).toHaveText('—')
  expect(await sent(page)).toEqual([{ url: 'target-date', body: { date: null } }])
})

test('an author edits the review due date, which has no Clear', async ({ page }) => {
  await openPanel(page, { canEditReviewDue: true, reviewDue: `${NEXT_YEAR}-02-10T00:00:00.000Z` })
  await expect(page.locator('[data-action="edit-target-date"]')).toHaveCount(0)
  await page.locator('[data-action="edit-review-due"]').click()
  await expect(page.locator('[data-action="clear-review-due"]')).toHaveCount(0)
  await page.locator('[data-field="review-due-input"]').fill(LATER)
  await page.locator('[data-action="save-review-due"]').click()
  await expect(field(page, 'review-due').locator('[data-deadline-value]')).toContainText(`20 Jun ${NEXT_YEAR}`)
  expect(await sent(page)).toEqual([{ url: 'review-due-date', body: { date: LATER } }])
})

test('a past date is refused in the form, and a server refusal is shown', async ({ page }) => {
  await openPanel(page, { canEditTarget: true, refuse: true })
  await page.locator('[data-action="edit-target-date"]').click()
  await page.locator('[data-field="target-date-input"]').fill('2020-01-01')
  await expect(page.locator('[data-action="save-target-date"]')).toBeDisabled()
  await expect(page.locator('[data-deadline-past]')).toBeVisible()

  await page.locator('[data-field="target-date-input"]').fill(LATER)
  await page.locator('[data-action="save-target-date"]').click()
  await expect(page.locator('[data-deadline-error]')).toContainText('signed or its project is closed')
  await expect(page.locator('[data-field="target-date-input"]')).toHaveValue(LATER)
})

test('someone who may not change them sees the dates but no Edit', async ({ page }) => {
  await openPanel(page, { target: `${NEXT_YEAR}-01-10T00:00:00.000Z`, reviewDue: `${NEXT_YEAR}-02-10T00:00:00.000Z` })
  await expect(field(page, 'review-due').locator('[data-deadline-value]')).toContainText(`10 Feb ${NEXT_YEAR}`)
  await expect(page.locator('[data-action="edit-target-date"]')).toHaveCount(0)
  await expect(page.locator('[data-action="edit-review-due"]')).toHaveCount(0)
})

test('the project dashboard lists deadlines, soonest first, and flags overdue ones', async ({ page }) => {
  await stub(page, {
    target: '2020-01-10T00:00:00.000Z',
    reviewDue: `${NEXT_YEAR}-02-10T00:00:00.000Z`,
    extraDocs: [
      { id: 'D-LATER', projectId: PROJECT_ID, type: 'protocol', title: 'Later doc', status: 'in-authoring', stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', targetCompletionDate: `${NEXT_YEAR}-09-01T00:00:00.000Z`, reviewDueAt: '2020-01-01T00:00:00.000Z', sections: [] },
      { id: 'D-SIGNED', projectId: PROJECT_ID, type: 'protocol', title: 'Signed doc', status: 'signed', stage: 'final-output', version: 'v1.0', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', targetCompletionDate: '2020-01-01T00:00:00.000Z', sections: [] },
      { id: 'D-NONE', projectId: PROJECT_ID, type: 'protocol', title: 'Undated doc', status: 'in-authoring', stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-20T09:00:00Z', sections: [] },
    ],
  })
  await page.goto(`/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' })
  // The Deadlines card sits in the row of KPI cards: it shows the overdue count and the most urgent date, and
  // opens the full list when clicked.
  const card = page.locator('[data-deadlines-card]')
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card.locator('[data-deadlines-overdue]')).toHaveText('1')
  await expect(card.locator('[data-deadlines-next]')).toContainText('Dates test')
  await card.click()
  await expect(page.locator('[data-section="deadlines"]')).toBeVisible()

  const rows = page.locator('[data-deadline-row]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Dates test')
  await expect(rows.nth(1)).toContainText('Later doc')

  const first = page.locator(`[data-deadline-row="${DOC}"]`)
  await expect(first.locator('[data-deadline-cell="target"]')).toHaveAttribute('data-overdue', 'true')
  await expect(first.locator('[data-deadline-cell="review"]')).not.toHaveAttribute('data-overdue', 'true')

  // A review date left over from an earlier round isn't a live deadline once the document is out of review.
  const later = page.locator('[data-deadline-row="D-LATER"]')
  await expect(later.locator('[data-deadline-cell="review"]')).toContainText('—')
  await expect(later.locator('[data-deadline-cell="review"]')).not.toHaveAttribute('data-overdue', 'true')
})
