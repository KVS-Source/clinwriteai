// QA regression — an auditor's screens don't attempt what the API would refuse.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJ-X/DOC-ID E2E_AUDITOR_PERSONA=<user id> \
//     npx playwright test playwright/smoke/27-auditor-read-only.spec.ts
//
// Any write the page tries is recorded and answered inside it, so nothing reaches the API. The
// server's own refusal of every write route is covered by apps/api/src/auth/auditor-read-only.test.ts.

import { test, expect, type Page } from '@playwright/test'

const DOC = process.env.E2E_DOC
const AUDITOR = process.env.E2E_AUDITOR_PERSONA
test.setTimeout(120_000)
test.skip(!DOC || !AUDITOR, 'set E2E_DOC to PROJECT/DOCUMENT and E2E_AUDITOR_PERSONA to an auditor user id')

async function asAuditor(page: Page) {
  await page.addInitScript((persona) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const writes: string[] = []
    ;(window as unknown as { __writes: string[] }).__writes = writes
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        writes.push(`${method} ${new URL(url, window.location.href).pathname}`)
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return real(input, init)
    }
  }, AUDITOR!)
}

const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)

test('reading a document sends no writes: no presence join, heartbeat or section lock', async ({ page }) => {
  await asAuditor(page)
  const [projectId, documentId] = DOC!.split('/')
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-open-comments]')).toBeVisible({ timeout: 60_000 })
  // Long enough to cover the first 15-second heartbeat.
  await page.waitForTimeout(17_000)
  const seen = await writes(page)
  expect(seen.filter(w => w.includes(documentId!))).toEqual([])
})

test('the project page offers no Upload source document', async ({ page }) => {
  await asAuditor(page)
  const [projectId] = DOC!.split('/')
  await page.goto(`/projects/${projectId}/clinical-writing`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-doc-row]').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-action="upload-source"]')).toHaveCount(0)
})
