// QA regression — Submit for review, each author (R) their own part. When other authors still have to
// submit, the API answers 202 (partSubmitted + pendingAuthors): the panel stays open with a "your part is
// submitted, waiting for …" notice, Submit is disabled, and the document is NOT shown as In Review.
// A non-author gets the R-specific refusal message.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/21-submit-part-for-review.spec.ts
//
// /auth/me, the document and submit-for-review are answered inside the page; nothing is written. Any other API
// call that comes back 401 (no real session in the test) is turned into a 503 so the page isn't redirected.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-SUB'
const DOC = 'DOC-E2E-SUB'

async function openSubmitPanel(page: Page, submit: { status: number; body: unknown }) {
  await page.addInitScript(({ project, doc, submit }) => {
    const me = { id: 'u-ann', email: 'ann@example.com', name: 'Ann Author', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'CSR Full', status: 'in-authoring', stage: 'study-start-up',
      version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u-ann', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'not-started', contentHtml: '<p>Text.</p>' }],
    }
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    ;(window as unknown as { __submits: number }).__submits = 0
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: true })
      if (url.includes(`/documents/${doc}/submit-for-review`) && method === 'POST') {
        (window as unknown as { __submits: number }).__submits++
        return json(submit.body, submit.status)
      }
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, submit })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}?submit=1`)
  await expect(page.locator('input[type="date"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type="date"]').fill('2026-11-20')
}

// The panel's own button ("Submit for review →"), not the editor header's "Submit for review" that opens the panel.
const submitButton = (page: Page) => page.getByRole('button', { name: 'Submit for review →', exact: true })

test('another author still to submit → "your part is submitted" notice; panel stays open and nothing shows In Review', async ({ page }) => {
  await openSubmitPanel(page, { status: 202, body: {
    id: DOC, status: 'in_authoring', partSubmitted: true, pendingAuthors: [{ userId: 'u-ben', name: 'Ben Author' }],
  } })
  await submitButton(page).dispatchEvent('click')

  const notice = page.locator('[data-part-submitted]')
  await expect(notice).toContainText('Your part is submitted')
  await expect(notice).toContainText('Ben Author')
  await expect(submitButton(page)).toBeDisabled()                        // re-submitting would change nothing
  await expect(page.locator('input[type="date"]')).toBeVisible()          // the panel did not close
  expect(await page.evaluate(() => (window as unknown as { __submits: number }).__submits)).toBe(1)
})

test('a non-author gets the author-only refusal', async ({ page }) => {
  await openSubmitPanel(page, { status: 403, body: { error: 'submit_forbidden', message: 'Only an author (R) on this document can submit it for review.' } })
  await submitButton(page).dispatchEvent('click')
  await expect(page.getByRole('alert')).toContainText('Only an author (R) on this document can submit it for review.')
})
