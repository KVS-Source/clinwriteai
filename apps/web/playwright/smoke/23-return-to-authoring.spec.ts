// QA regression — "Return to authoring": a Reviewer (C), QC (Q) or Approver (A) sends the document back one
// stage with a required note. The API moves it to In Authoring with a new version snapshot; the screen confirms
// it and shows the new status. Authors (R) don't get the action, nor does a document already in authoring.
// While awaiting signature the Reviewer View is unavailable, so an Approver returns it from E-Signature.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/23-return-to-authoring.spec.ts
//
// /auth/me, the document, its RACI, signature chains and the reject call are answered inside the page; nothing is
// written. Any other API call that comes back 401 (no real session in the test) is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-RET'
const DOC = 'DOC-E2E-RET'

async function open(page: Page, opts: { letter: 'C' | 'Q' | 'A' | 'R'; status: string; screen: 'review' | 'sign' }) {
  await page.addInitScript(({ project, doc, letter, status }) => {
    const me = { id: 'u-me', email: 'me@example.com', name: 'Mia Member', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const state = { status }
    const document = () => ({
      id: doc, projectId: project, type: 'protocol', title: 'Protocol v2', status: state.status, stage: 'cross-functional-review',
      version: 'v0.2', therapeuticArea: 'Oncology', assigneeId: 'u-author', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Text.</p>' }],
    })
    const w = window as unknown as { __rejects: Array<{ url: string; body: unknown }> }
    w.__rejects = []
    const real = window.fetch.bind(window)
    const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/documents/${doc}/raci/raci-me/reject`) && method === 'POST') {
        w.__rejects.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
        state.status = 'in-authoring'
        return json({ row: { id: 'raci-me' }, document: { id: doc, status: 'in_authoring' }, version: { id: 'ver-3', versionNumber: 'v0.3' } })
      }
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: letter === 'R' })
      if (/\/raci(\?.*)?$/.test(url) && url.includes(`/documents/${doc}/`) && method === 'GET') {
        return json([{ id: 'raci-me', documentId: doc, userId: 'u-me', letter, sectionId: null, removedAt: null, rejectedAt: null, signatureRequired: false }])
      }
      if (url.includes(`/documents/${doc}/signature-chains`) && method === 'GET') return json([])
      if (url.includes(`/documents/${doc}/comments`) && method === 'GET') return json([])
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document())
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, letter: opts.letter, status: opts.status })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}/${opts.screen}`, { waitUntil: 'domcontentloaded' })
}

const returnButton  = (page: Page) => page.locator('[data-action="return-to-authoring"]')
const confirmButton = (page: Page) => page.locator('[data-action="confirm-return"]')
const note          = (page: Page) => page.locator('[data-input="return-note"]')
const rejects = (page: Page) => page.evaluate(() => (window as unknown as { __rejects: Array<{ url: string; body: { note: string } }> }).__rejects)

test('a reviewer (C) returns the document with a required note → In Authoring as the new version', async ({ page }) => {
  await open(page, { letter: 'C', status: 'in-review', screen: 'review' })
  await expect(returnButton(page)).toBeVisible({ timeout: 60_000 })
  await returnButton(page).dispatchEvent('click')

  const dialog = page.locator('[data-return-dialog]')
  await expect(dialog).toBeVisible()
  await expect(confirmButton(page)).toBeDisabled()                 // the note is required
  await note(page).fill('   ')
  await expect(confirmButton(page)).toBeDisabled()                 // a blank note doesn't count
  await note(page).fill('Section 9 contradicts the SAP.')
  await confirmButton(page).dispatchEvent('click')

  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Returned to authoring as v0.3.')).toBeVisible()
  expect((await rejects(page))[0].body).toEqual({ note: 'Section 9 contradicts the SAP.' })
  await expect(page.locator('[data-document-status]')).toHaveAttribute('data-document-status', 'in-authoring')
  await expect(returnButton(page)).toHaveCount(0)                  // nothing left to return
})

test('an author (R) does not get the action', async ({ page }) => {
  await open(page, { letter: 'R', status: 'in-review', screen: 'review' })
  await expect(page.locator('[data-document-status]')).toBeVisible({ timeout: 60_000 })
  await expect(returnButton(page)).toHaveCount(0)
})

test('a document already in authoring cannot be returned', async ({ page }) => {
  await open(page, { letter: 'C', status: 'in-authoring', screen: 'review' })
  await expect(page.locator('[data-document-status]')).toBeVisible({ timeout: 60_000 })
  await expect(returnButton(page)).toHaveCount(0)
})

test('an approver (A) returns it from E-Signature while it awaits signature, and lands in the editor', async ({ page }) => {
  await open(page, { letter: 'A', status: 'pending-signature', screen: 'sign' })
  await expect(returnButton(page)).toBeVisible({ timeout: 60_000 })
  await returnButton(page).dispatchEvent('click')
  await note(page).fill('Wrong signatory order.')
  await confirmButton(page).dispatchEvent('click')
  await expect(page).toHaveURL(new RegExp(`/documents/${DOC}$`), { timeout: 30_000 })
  expect((await rejects(page))[0].body).toEqual({ note: 'Wrong signatory order.' })
})
