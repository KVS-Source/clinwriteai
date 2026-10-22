// QA regression — Clinical Writing "Source Documents" tab.
//
// The tab sits next to "All Stages" and lists every file uploaded to the
// project, evidence-library style: counters, state filter, search, sortable
// columns, paging and a per-file download.
//
//   E2E_BASE_URL=https://demo.clinwrite.ai E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/08-source-documents-tab.spec.ts
// Optional: E2E_CHANNEL=msedge. Tests that need rows skip when the project has none.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID

// The list is served by a remote API + database; a cold page load can take 20-50 s.
test.setTimeout(120_000)

async function openTab(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  const tab = page.getByRole('button', { name: /^Source Documents/ })
  await expect(tab).toBeVisible({ timeout: 60_000 })
  await tab.click()
  await expect(page.locator('[data-screen="source-documents"]')).toBeVisible({ timeout: 30_000 })
  // wait for the first load to settle (rows, empty state or error)
  await page.waitForSelector('[data-source-row], [data-empty], [role="alert"]', { timeout: 60_000 })
}

const rows = (page: Page) => page.locator('[data-source-row]')

test('tab sits right after "All Stages" and opens the library', async ({ page }) => {
  await openTab(page)
  const labels = await page.locator('button', { hasText: /^(All Stages|Source Documents|Study Start-Up)/ }).allInnerTexts()
  expect(labels[0]).toBe('All Stages')
  expect(labels[1]).toMatch(/^Source Documents/)
  await expect(page.getByRole('heading', { name: 'Source documents' })).toBeVisible()
  await expect(page.locator('[data-count="files"]')).toBeVisible()
  await expect(page.locator('[data-count="unlinked"]')).toBeVisible()
  for (const col of ['Document title', 'File', 'Type', 'State', 'Scan', 'Linked document', 'Uploaded']) {
    await expect(page.getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible()
  }
})

test('the counter matches the rows and the tab label', async ({ page }) => {
  await openTab(page)
  const files = Number(await page.locator('[data-count="files"]').innerText())
  await expect(page.getByRole('button', { name: new RegExp(`^Source Documents \\(${files}\\)`) })).toBeVisible()
  if (files <= 50) await expect(rows(page)).toHaveCount(files)
  await expect(page.locator('[data-pager-status]')).toContainText(`${files} ${files === 1 ? 'file' : 'files'}`)
})

test('search narrows the list and "Clear filters" restores it', async ({ page }) => {
  await openTab(page)
  const before = await rows(page).count()
  test.skip(before === 0, 'project has no source documents')
  const name = (await rows(page).first().locator('td').nth(1).locator('p').first().innerText()).trim()
  await page.locator('[data-filter="search"]').fill(name)
  await expect(rows(page).first()).toBeVisible()
  expect(await rows(page).count()).toBeLessThanOrEqual(before)
  await expect(rows(page).first()).toContainText(name)

  await page.locator('[data-filter="search"]').fill('zzz-no-such-file-zzz')
  await expect(page.locator('[data-empty]')).toContainText(/No source documents match/i)
  await page.locator('[data-action="clear-filters"]').click()
  await expect(rows(page)).toHaveCount(before)
})

test('state filter only shows that state', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  await page.locator('[data-filter="state"]').selectOption('pending')
  await page.waitForTimeout(600)
  for (const pill of await rows(page).locator('td:nth-child(4)').allInnerTexts()) expect(pill.trim()).toBe('Pending')
})

test('clicking a header sorts, and clicking again reverses', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) < 2, 'needs at least two rows')
  const files = async () => rows(page).locator('td:nth-child(2) p:first-child').allInnerTexts()
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

  await page.locator('[data-sort="file"]').click()
  await expect(page.getByRole('columnheader', { name: /^File/i })).toHaveAttribute('aria-sort', 'ascending')
  // the list re-fetches after the click; poll until the rows actually arrive sorted
  await expect.poll(async () => { const f = await files(); return JSON.stringify(f) === JSON.stringify([...f].sort(byName)) }, { timeout: 15_000 }).toBe(true)

  await page.locator('[data-sort="file"]').click()
  await expect(page.getByRole('columnheader', { name: /^File/i })).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(async () => { const f = await files(); return JSON.stringify(f) === JSON.stringify([...f].sort((a, b) => byName(b, a))) }, { timeout: 15_000 }).toBe(true)
})

test('Download delivers the stored file, or clearly explains why it cannot', async ({ page }) => {
  await openTab(page)
  const buttons = page.locator('[data-source-row] [data-action="download"]')
  test.skip((await buttons.count()) === 0, 'no downloadable source document')

  // A row can outlive its stored file (e.g. uploaded from another environment). Click
  // through until one downloads; any that fail must say so and stop offering Download.
  let downloaded: string | null = null
  let explained = 0
  for (let attempts = 0; attempts < 8 && !downloaded && (await buttons.count()) > 0; attempts++) {
    const outcome = await Promise.race([
      page.waitForEvent('download', { timeout: 20_000 }).then(d => ({ kind: 'download' as const, name: d.suggestedFilename() })),
      page.locator('[data-download-notice]').waitFor({ timeout: 20_000 }).then(() => ({ kind: 'notice' as const })),
      buttons.first().click().then(() => new Promise<never>(() => undefined)),   // trigger, never settles
    ])
    if (outcome.kind === 'download') downloaded = outcome.name
    else { explained++; await page.locator('[data-download-notice] button').click() }
  }
  expect(downloaded !== null || explained > 0).toBe(true)
  if (downloaded) expect(downloaded.length).toBeGreaterThan(0)
  if (explained > 0) await expect(page.locator('[data-source-row]', { hasText: 'File missing' }).first()).toBeVisible()
})

test('after uploading a source document you stay on the Source Documents tab (no redirect to the editor)', async ({ page }) => {
  // The upload (XHR) and confirm (fetch) calls are answered inside the page, so this exercises
  // the UI flow WITHOUT writing to the database or storage. Done in-page because the app's mock
  // service worker would bypass page.route(), and blocking it stops the app from booting.
  await page.addInitScript(() => {
    const w = window as unknown as { __hits: { upload: number; confirm: number } }
    w.__hits = { upload: 0, confirm: 0 }
    const classification = {
      documentType: 'protocol', typeConfidence: 90, studyTitle: 'E2E Protocol', studyConfidence: 90,
      version: 'v1.0', versionConfidence: 90, therapeuticArea: 'Oncology', taConfidence: 90, frameworks: ['ICH E6(R3)'], stub: false,
    }
    const upload = { uploadId: 'e2e-upload-1', fileName: 'e2e-protocol-v1.pdf', fileSizeMB: 0.01, virusScanStatus: 'passed', classification }

    const realFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/projects\/[^/]+\/documents\/confirm-classification/.test(url)) {
        w.__hits.confirm++
        return Promise.resolve(new Response(JSON.stringify({ id: 'DOC-E2E-MOCK', title: 'E2E Protocol' }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      }
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
      if (/\/projects\/[^/]+\/documents\/upload$/.test(this.__url ?? '')) {
        w.__hits.upload++
        setTimeout(() => {
          Object.defineProperty(this, 'status', { value: 200 })
          Object.defineProperty(this, 'responseText', { value: JSON.stringify(upload) })
          this.dispatchEvent(new Event('load'))
        }, 50)
        return
      }
      return send.call(this, body)
    }
  })
  const hits = () => page.evaluate(() => (window as unknown as { __hits: { upload: number; confirm: number } }).__hits)

  await openTab(page)
  const tabUrl = page.url()
  await page.locator('[data-action="upload-source"]').click()
  await page.locator('[data-form="upload-document"] input[type="file"]').setInputFiles({
    name: 'e2e-protocol-v1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e'),
  })
  await expect(page.locator('[data-form="upload-document-review"]')).toBeVisible({ timeout: 30_000 })
  // Safety: the upload was answered by the in-page mock, never by the real API.
  expect((await hits()).upload).toBe(1)

  // fill everything the review form requires, whatever it prefilled
  const review = page.locator('[data-form="upload-document-review"]')
  const text = review.locator('input:not([type="radio"])')
  await text.nth(0).fill('E2E Protocol')       // study title
  await text.nth(1).fill('v1.0')               // version
  const ta = page.locator('[data-ta-select]')
  if (!(await ta.inputValue())) await ta.selectOption({ index: 1 })
  const assignee = review.locator('select').last()
  await expect(assignee.locator('option')).not.toHaveCount(1, { timeout: 30_000 })   // owners loaded
  await assignee.selectOption({ index: 1 })
  // Submit with Enter: in dev builds the "MSW: n groups" badge floats over this button and
  // swallows the click (it isn't in production builds). The button must still be enabled.
  await expect(page.getByRole('button', { name: /Confirm & create document/ })).toBeEnabled()
  await text.nth(1).press('Enter')

  // drawer closes, success notice shows, and we are STILL on the project's Clinical Writing
  // page with the Source Documents tab selected — not on /documents/DOC-E2E-MOCK
  await expect(page.locator('[data-upload-success]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-form="upload-document-review"]')).toHaveCount(0)
  await expect(page.locator('[data-screen="source-documents"]')).toBeVisible()
  expect(page.url()).toBe(tabUrl)
  expect(page.url()).not.toContain('/documents/')
  expect((await hits()).confirm).toBe(1)

  // the notice offers (but does not force) a way to the editor
  await expect(page.locator('[data-action="open-created-document"]')).toBeVisible()
})
