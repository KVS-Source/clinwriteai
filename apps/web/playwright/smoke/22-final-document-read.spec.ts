// QA regression — the Final Document screen reads its content through GET /documents/:id/final, the
// endpoint that applies the Final Document access rule on the server (never admin or guest, not QC (Q) alone).
// A reviewer (C) sees the screen; QC (Q) alone gets the access-denied view and the content read is refused.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/22-final-document-read.spec.ts
//
// /auth/me, the RACI list and both document reads are answered inside the page; nothing is written. Any other
// API call that comes back 401 (no real session in the test) is turned into a 503 so the page isn't redirected.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-FIN'
const DOC = 'DOC-E2E-FIN'

async function openFinalAs(page: Page, letter: 'C' | 'Q') {
  await page.addInitScript(({ project, doc, letter }) => {
    const me = { id: 'u-me', email: 'me@example.com', name: 'Mia Member', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'protocol', title: 'Protocol v2', status: 'signed', stage: 'final-output',
      version: 'v1.0', therapeuticArea: 'Oncology', assigneeId: 'u-author', updatedAt: '2026-11-04T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Final text.</p>' }],
    }
    const w = window as unknown as { __finalReads: number }
    w.__finalReads = 0
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/documents/${doc}/raci`) && !url.includes('/raci/') && method === 'GET') {
        return json([{ id: 'raci-1', documentId: doc, userId: 'u-me', letter, sectionId: null, removedAt: null }])
      }
      if (url.includes(`/documents/${doc}/final`) && method === 'GET') {
        w.__finalReads++
        // What the API now answers: the Final Document rule refuses QC (Q) on its own.
        return letter === 'Q' ? json({ error: 'final_document_forbidden' }, 403) : json(document)
      }
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url) && method === 'GET') return json(document)
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, letter })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}/final`, { waitUntil: 'domcontentloaded' })
}

test('a reviewer (C) sees the Final Document, loaded from the Final Document endpoint', async ({ page }) => {
  await openFinalAs(page, 'C')
  await expect(page.locator('[data-screen="final-document"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-final-access-denied]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __finalReads: number }).__finalReads)).toBeGreaterThan(0)
})

test('QC (Q) alone gets the access-denied view', async ({ page }) => {
  await openFinalAs(page, 'Q')
  await expect(page.locator('[data-final-access-denied]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-screen="final-document"]')).toHaveCount(0)
})
