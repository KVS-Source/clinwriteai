// QA regression — a project manager can read and download the audit trail, and download a signed document.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_SIGNED_DOC=PROJ-X/DOC-ID \
//     npx playwright test playwright/smoke/20-pm-audit-and-final.spec.ts
//
// The export is answered inside the page (a real one appends an audit entry), so nothing is written.
// E2E_SIGNED_DOC is a signed document with a completed signature chain that the PM can see.

import { test, expect, type Page } from '@playwright/test'

const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
const SIGNED_DOC = process.env.E2E_SIGNED_DOC
test.setTimeout(120_000)

async function asPm(page: Page) {
  await page.addInitScript((persona) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/admin\/audit\/export/.test(url)) {
        const headers = new Headers(init?.headers)
        ;(window as unknown as { __exportPersona?: string | null }).__exportPersona = headers.get('X-Demo-Persona')
        return new Response('id,action\n1,document_created\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="audit-test.csv"' },
        })
      }
      return real(input, init)
    }
  }, PM_PERSONA)
}

test('the PM opens the audit trail from the sidebar and downloads it as themselves', async ({ page }) => {
  await asPm(page)
  await page.goto('/home', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-platform-link="/admin/audit"]').first().click({ timeout: 60_000 })

  await expect(page.locator('[data-screen="audit-trail-viewer-live"]')).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/admin\/audit/)
  await expect(page.locator('[data-section="pm-scope-notice"]')).toBeVisible()
  await expect(page.locator('[data-action="verify-chain"]')).toHaveCount(0)

  const exportButton = page.locator('button[data-action="export-csv"]:not([disabled])')
  await expect(exportButton).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toBe('audit-test.csv')
  expect(await page.evaluate(() => (window as unknown as { __exportPersona?: string | null }).__exportPersona)).toBe(PM_PERSONA)
})

test('a contributor has no audit trail link and is turned away from the page', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('clinwrite.demo.currentUserId', 'cmv7x2f920001gtoivawht3vn'))
  await page.goto('/home', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-sidebar-section="library"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-platform-link="/admin/audit"]')).toHaveCount(0)

  await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveURL(/\/admin\/audit/, { timeout: 30_000 })
  await expect(page.locator('[data-screen="audit-trail-viewer-live"]')).toHaveCount(0)
})

test('the PM can open a signed document and download it', async ({ page }) => {
  test.skip(!SIGNED_DOC, 'set E2E_SIGNED_DOC to PROJECT/DOCUMENT')
  const [projectId, documentId] = SIGNED_DOC!.split('/')
  await asPm(page)
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/final`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-screen="final-document"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-signed-banner="signed"]')).toBeVisible()
  await expect(page.locator('[data-final-access-denied]')).toHaveCount(0)

  // Download PDF is a file from the server (spec 34 and final-pdf.test.ts cover it in full). Answered
  // here so the test doesn't add an export to the real audit trail.
  await page.route('**/final/pdf', route => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    headers: { 'Content-Disposition': 'attachment; filename="stub.pdf"' },
    body: '%PDF-1.4 stub',
  }))
  const button = page.getByRole('button', { name: 'Download PDF' })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  const download = page.waitForEvent('download')
  await button.click()
  expect((await download).suggestedFilename()).toBe('stub.pdf')
})
