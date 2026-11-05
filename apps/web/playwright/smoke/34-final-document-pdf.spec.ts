// QA regression — "Download PDF" on the Final Document gets a file from the server instead of opening
// the browser's print dialog, and shows the server's reason when it refuses.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/34-final-document-pdf.spec.ts
//
// The document, chain and PDF are answered inside the page, so no export reaches the real audit trail.
// What the PDF contains and when it's refused are in
// apps/api/src/modules/clinical-writing/documents/final-pdf.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-FINAL'
const DOC = 'DOC-E2E-FINAL'

type Stub = { status: string; records?: boolean; refuse?: { error: string; message: string } }

async function open(page: Page, stub: Stub) {
  await page.addInitScript(({ project, doc, stub }) => {
    const me = { id: 'u-e2e', email: 'e2e@example.com', name: 'E2E User', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const document = {
      id: doc, projectId: project, type: 'csr-full', title: 'E2E Final', status: stub.status, stage: 'final-output', version: stub.status === 'signed' ? 'v1.0' : 'v0.2',
      therapeuticArea: 'Oncology', assigneeId: 'u-other', updatedAt: '2026-11-04T09:00:00Z', signedAt: stub.status === 'signed' ? '2026-10-28T15:47:00Z' : null, watermarked: stub.status !== 'signed',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Text.</p>' }],
    }
    const chains = stub.records === false ? [] : [{
      id: 'c1', initiatedAt: '2026-10-28T10:00:00Z',
      records: [{ id: 'SIG-1', signerName: 'Asha Rao', signerRole: 'Author', meaning: 'authored', status: 'signed', step: 1, timestampUtc: '2026-10-28T15:47:00Z', documentHash: 'a'.repeat(64) }],
    }]
    const w = window as unknown as { __pdf: number; __printed: number }
    w.__pdf = 0
    w.__printed = 0
    window.print = () => { w.__printed++ }
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes(`/documents/${doc}/final/pdf`)) {
        w.__pdf++
        await new Promise(r => setTimeout(r, 1500))
        if (stub.refuse) return json(stub.refuse, 409)
        return new Response('%PDF-1.4 stub', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="E2E_Final_v1.0_Final.pdf"' } })
      }
      if (url.includes(`/documents/${doc}/final`) && method === 'GET') return json(document)
      if (url.includes(`/documents/${doc}/signature-chains`)) return json(chains)
      if (url.includes(`/documents/${doc}/compliance-summary`)) return json({ documentId: doc, checklistTemplateVersion: 1, generatedAt: '2026-11-01T00:00:00Z', frameworks: [], waivedMandatory: [], removedMandatory: [] })
      if (url.includes(`/documents/${doc}/raci`)) return json([])
      if (new RegExp(`/documents/${doc}(/|\\?|$)`).test(url)) return json(method === 'GET' ? document : {})
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url)) return json({ id: project, name: 'E2E', shortTitle: 'E2E', client: 'x', therapeuticArea: 'Oncology', phase: '1', status: 'ongoing', activeModules: ['A'], team: [] })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, stub })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}/final`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-screen="final-document"]')).toBeVisible({ timeout: 60_000 })
}

const button = (page: Page) => page.locator('[data-action="download-final-pdf"]')
const counts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __pdf: number; __printed: number }
  return { pdf: w.__pdf, printed: w.__printed }
})

test('a signed document downloads a server PDF, with no print dialog', async ({ page }) => {
  await open(page, { status: 'signed' })
  await expect(button(page)).toHaveText('Download PDF')
  const download = page.waitForEvent('download')
  await button(page).click()
  expect((await download).suggestedFilename()).toBe('E2E_Final_v1.0_Final.pdf')
  expect(await counts(page)).toEqual({ pdf: 1, printed: 0 })
  await expect(button(page)).toBeEnabled()
})

test('while it is being made, the button says so and can\'t be pressed twice', async ({ page }) => {
  await open(page, { status: 'signed' })
  const download = page.waitForEvent('download')
  await button(page).click()
  await expect(button(page)).toHaveText('Preparing PDF…')
  await expect(button(page)).toBeDisabled()
  await download
})

test('an unsigned document offers a draft PDF', async ({ page }) => {
  await open(page, { status: 'in-review' })
  await expect(button(page)).toHaveText('Download draft PDF')
  await expect(button(page)).toHaveAttribute('title', /watermarked/)
  const download = page.waitForEvent('download')
  await button(page).click()
  await download
})

test('"signed" with no signatures on record can\'t be downloaded', async ({ page }) => {
  await open(page, { status: 'signed', records: false })
  await expect(button(page)).toBeDisabled()
  await expect(button(page)).toHaveAttribute('title', /No signature records/)
})

test('a refusal shows the server\'s reason, which can be dismissed, and no file arrives', async ({ page }) => {
  const message = "This document's content no longer matches what was signed, so it can't be exported as a signed document."
  await open(page, { status: 'signed', refuse: { error: 'signed_content_changed', message } })
  let downloads = 0
  page.on('download', () => { downloads++ })
  await button(page).click()
  const alert = page.locator('[data-final-pdf-error]')
  await expect(alert).toContainText(message)
  expect(downloads).toBe(0)
  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(alert).toHaveCount(0)
})
