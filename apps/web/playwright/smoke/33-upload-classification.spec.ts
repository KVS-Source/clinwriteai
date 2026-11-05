// QA regression — the upload form shows the AI's suggested category and version for the user to
// confirm, and says plainly when a suggestion is only a filename guess.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-X \
//     npx playwright test playwright/smoke/33-upload-classification.spec.ts
//
// The upload (XHR) and save are answered inside the page, so nothing is stored and no AI call is made.
// The classifier itself is in apps/api/src/modules/clinical-writing/documents/source-classifier.test.ts.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)

const AI = {
  sourceCategory: 'sap', sourceCategoryConfidence: 93, version: '2.1', versionConfidence: 88, versionSource: 'ai',
  stub: false, classifiedBy: 'ai', reason: 'The first line says Statistical Analysis Plan.',
}
const GUESS = {
  sourceCategory: 'protocol', sourceCategoryConfidence: 90, version: 'v2', versionConfidence: 85, versionSource: 'filename',
  stub: true, classifiedBy: 'filename',
}

async function uploadWith(page: Page, classification: Record<string, unknown>) {
  await page.addInitScript(({ persona, projectId, classification }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const w = window as unknown as { __save: unknown[]; __upload: number }
    w.__save = []
    w.__upload = 0
    const realFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/projects/${projectId}/source-documents/access`)) {
        return Promise.resolve(new Response(JSON.stringify({ canView: true, canUpload: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (/\/source-documents\/e2e-up\/save/.test(url)) {
        w.__save.push(JSON.parse(String(init?.body)))
        return Promise.resolve(new Response(JSON.stringify({ id: 'e2e-up' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (init?.method === 'DELETE' && /\/source-documents\/e2e-up$/.test(url)) return Promise.resolve(new Response(null, { status: 204 }))
      return realFetch(input, init)
    }
    const open = XMLHttpRequest.prototype.open
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __url?: string }, method: string, url: string | URL, ...rest: unknown[]) {
      this.__url = String(url)
      // @ts-expect-error — forwarding the original variadic signature
      return open.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __url?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
      if (/\/documents\/upload$/.test(this.__url ?? '')) {
        w.__upload++
        setTimeout(() => {
          Object.defineProperty(this, 'status', { value: 200 })
          Object.defineProperty(this, 'responseText', { value: JSON.stringify({ uploadId: 'e2e-up', fileName: 'scan0001.pdf', fileSizeMB: 0.01, virusScanStatus: 'passed', classification }) })
          this.dispatchEvent(new Event('load'))
        }, 50)
        return
      }
      return send.call(this, body)
    }
  }, { persona: PM, projectId: PROJECT_ID, classification })

  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-action="upload-source"]').click({ timeout: 60_000 })
  await page.locator('[data-form="upload-document"] input[type="file"]').setInputFiles({ name: 'scan0001.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') })
  const review = page.locator('[data-form="upload-document-review"]')
  await expect(review).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { __upload: number }).__upload)).toBe(1)
  return review
}

const saved = (page: Page) => page.evaluate(() => (window as unknown as { __save: Array<Record<string, unknown>> }).__save)

test('an AI suggestion is prefilled, explained and marked, and is kept only on save', async ({ page }) => {
  const review = await uploadWith(page, AI)
  await expect(review.locator('[data-classification-note="ai"]')).toContainText('Check them, then save to confirm')
  await expect(review.locator('[data-classification-note="filename"]')).toHaveCount(0)
  await expect(review.locator('[data-source-category]')).toHaveValue('sap')
  await expect(review.locator('[data-classification-reason]')).toHaveText(AI.reason)
  await expect(review).toContainText('AI pick')
  await expect(review).toContainText('93%')
  expect(await saved(page)).toEqual([])

  await review.locator('input').first().press('Enter')
  await expect.poll(() => saved(page)).toHaveLength(1)
  expect((await saved(page))[0]).toMatchObject({ category: 'sap', version: '2.1', overrides: [] })
})

test('the user can change the suggestion, and the change is recorded as an override', async ({ page }) => {
  const review = await uploadWith(page, AI)
  await review.locator('[data-source-category]').selectOption('protocol')
  await expect(review).toContainText('edited')
  await expect(review.locator('[data-classification-reason]')).toHaveCount(0)
  await expect(review).not.toContainText('93%')

  await review.locator('input').first().press('Enter')
  await expect.poll(() => saved(page)).toHaveLength(1)
  expect((await saved(page))[0]).toMatchObject({ category: 'protocol', overrides: ['category'] })
})

test('when the AI is unavailable, the form says the suggestion is a filename guess', async ({ page }) => {
  const review = await uploadWith(page, { ...GUESS, fallbackReason: 'ai_unavailable' })
  await expect(review.locator('[data-classification-note="filename"]')).toContainText('filename-based guesses')
  await expect(review.locator('[data-classification-note="filename"]')).toContainText("isn't available right now")
  await expect(review.locator('[data-classification-note="ai"]')).toHaveCount(0)
  await expect(review.locator('[data-source-category]')).toHaveValue('protocol')
  await expect(review).toContainText('from file name')
  await expect(review).not.toContainText('AI pick')
  await expect(review).not.toContainText('90%')
})

test("when the file can't be read, the form says so", async ({ page }) => {
  const review = await uploadWith(page, { ...GUESS, fallbackReason: 'unreadable' })
  await expect(review.locator('[data-classification-note="filename"]')).toContainText("can't be read automatically")
})

test('a version found only in the file name is marked as such, beside an AI category', async ({ page }) => {
  const review = await uploadWith(page, { ...AI, version: 'v3', versionConfidence: 85, versionSource: 'filename' })
  await expect(review.getByText('AI pick')).toHaveCount(1)
  await expect(review.getByText('from file name')).toHaveCount(1)
  await expect(review).not.toContainText('85%')
})
