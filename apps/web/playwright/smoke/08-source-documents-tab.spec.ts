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
  for (const col of ['Title', 'Category', 'State', 'Scan', 'Used in', 'Uploaded', 'Quick actions']) {
    await expect(page.getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible()
  }
  // Quick actions is the last column, right after Uploaded
  await expect(page.getByRole('columnheader', { name: /^File/i })).toHaveCount(0)   // file name lives in the detail panel
  const headers = await page.getByRole('columnheader').allInnerTexts()
  expect(headers.at(-1)?.trim().toLowerCase()).toBe('quick actions')
  expect(headers.at(-2)?.trim().toLowerCase()).toBe('uploaded')
})

test('each row has an Open button and a "⋯" menu with Download', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  const row = rows(page).first()
  await expect(row.locator('[data-action="open-source-row"]')).toBeVisible()
  await expect(row.locator('[data-action="create-document"]')).toHaveCount(0)
  await row.locator('[data-action="more"]').click()
  const menu = page.locator('[data-row-menu]')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Create document from this source' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Archive/ })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: /^Delete/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('row Open shows the detail panel with Open and Download, and no Create document', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  await rows(page).first().locator('[data-action="open-source-row"]').click()
  const panel = page.locator('[data-slide-panel]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-action="open-source"]')).toHaveText(/Open/)
  await expect(panel.locator('[data-action="download-source"]')).toBeVisible()
  await expect(panel.getByRole('button', { name: /Create document/ })).toHaveCount(0)
})

test('the menu is not clipped on the last row and closes on outside click', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  await rows(page).last().locator('[data-action="more"]').click()
  const menu = page.locator('[data-row-menu]')
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  await page.locator('[data-screen="source-documents"] h2, [data-screen="source-documents"] h3').first().click()
  await expect(menu).toHaveCount(0)
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
  const name = (await rows(page).first().locator('td').nth(0).locator('p').first().innerText()).trim()
  await page.locator('[data-filter="search"]').fill(name)
  await expect(rows(page).first()).toBeVisible()
  expect(await rows(page).count()).toBeLessThanOrEqual(before)
  await expect(rows(page).first()).toContainText(name)

  await page.locator('[data-filter="search"]').fill('zzz-no-such-file-zzz')
  await expect(page.locator('[data-empty]')).toContainText(/No source documents match/i)
  await page.locator('[data-action="clear-filters"]').click()
  await expect(rows(page)).toHaveCount(before)
})

test('state filter only shows that state, and unsaved uploads are never listed', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  const states = await rows(page).locator('td:nth-child(3)').allInnerTexts()
  for (const st of states) expect(['Saved', 'Rejected']).toContain(st.trim())   // no "Pending": unsaved uploads are not in the library
  await expect(page.locator('[data-filter="state"] option[value="pending"]')).toHaveCount(0)
  await page.locator('[data-filter="state"]').selectOption('saved')
  await page.waitForTimeout(600)
  for (const pill of await rows(page).locator('td:nth-child(3)').allInnerTexts()) expect(pill.trim()).toBe('Saved')
})

test('clicking a header sorts, and clicking again reverses', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) < 2, 'needs at least two rows')
  const files = async () => rows(page).locator('td:nth-child(1) p:first-child').allInnerTexts()
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

  await page.locator('[data-sort="title"]').click()
  await expect(page.getByRole('columnheader', { name: /^Title/i })).toHaveAttribute('aria-sort', 'ascending')
  // the list re-fetches after the click; poll until the rows actually arrive sorted
  await expect.poll(async () => { const f = await files(); return JSON.stringify(f) === JSON.stringify([...f].sort(byName)) }, { timeout: 15_000 }).toBe(true)

  await page.locator('[data-sort="title"]').click()
  await expect(page.getByRole('columnheader', { name: /^Title/i })).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(async () => { const f = await files(); return JSON.stringify(f) === JSON.stringify([...f].sort((a, b) => byName(b, a))) }, { timeout: 15_000 }).toBe(true)
})

test('clicking a row opens the detail panel; Esc, the cross and an outside click close it', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  const panel = page.locator('[data-panel="source-detail"]')

  await rows(page).first().click()
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Chain of custody', { exact: false })).toBeVisible()
  await expect(panel.locator('[data-action="open-source"]')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await rows(page).first().click()
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(panel).toHaveCount(0)

  await rows(page).first().click()
  await expect(panel).toBeVisible()
  await page.locator('[data-screen="source-documents"] h2').first().click()   // outside the panel
  await expect(panel).toHaveCount(0)
})

test('the quick-action buttons do not open the detail panel', async ({ page }) => {
  await openTab(page)
  test.skip((await rows(page).count()) === 0, 'project has no source documents')
  await rows(page).first().locator('[data-action="more"]').click()
  await expect(page.locator('[data-panel="source-detail"]')).toHaveCount(0)
})

test('Download delivers the stored file, or clearly explains why it cannot', async ({ page }) => {
  await openTab(page)
  // Download lives in each row's "⋯" menu. Rows already known to be missing are disabled in the menu.
  const moreButtons = page.locator('[data-source-row]:not(:has-text("File missing")) [data-action="more"]')
  test.skip((await moreButtons.count()) === 0, 'no downloadable source document')
  const buttons = {
    count: () => moreButtons.count(),
    first: () => ({
      click: async () => {
        await moreButtons.first().click()
        await page.locator('[data-row-menu] [data-action="download"]').click()
      },
    }),
  }

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

// Answers the upload (XHR), save and discard calls inside the page, so the UI flow runs WITHOUT
// writing to the database or storage. Done in-page because the app's mock service worker would
// bypass page.route(), and blocking it stops the app from booting.
async function mockUpload(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hits: { upload: number; save: number; confirm: number; discard: number } }
    w.__hits = { upload: 0, save: 0, confirm: 0, discard: 0 }
    const classification = {
      sourceCategory: 'protocol', sourceCategoryConfidence: 90, version: 'v1.0', versionConfidence: 90, stub: false,
    }
    const upload = { uploadId: 'e2e-upload-1', fileName: 'e2e-protocol-v1.pdf', fileSizeMB: 0.01, virusScanStatus: 'passed', classification }

    const realFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/projects\/[^/]+\/documents\/confirm-classification/.test(url)) w.__hits.confirm++
      if (init?.method === 'DELETE' && /\/projects\/[^/]+\/source-documents\/e2e-upload-1$/.test(url)) {
        w.__hits.discard++
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (/\/projects\/[^/]+\/source-documents\/[^/]+\/save/.test(url)) {
        w.__hits.save++
        return Promise.resolve(new Response(JSON.stringify({ id: 'e2e-upload-1', title: 'E2E Protocol', category: 'protocol' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
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
}

test('uploading a source document saves it to the library without creating a document', async ({ page }) => {
  // The upload (XHR) and confirm (fetch) calls are answered inside the page, so this exercises
  // the UI flow WITHOUT writing to the database or storage. Done in-page because the app's mock
  // service worker would bypass page.route(), and blocking it stops the app from booting.
  await mockUpload(page)
  const hits = () => page.evaluate(() => (window as unknown as { __hits: { upload: number; save: number; confirm: number; discard: number } }).__hits)

  await openTab(page)
  const tabUrl = page.url()
  await page.locator('[data-action="upload-source"]').click()
  await page.locator('[data-form="upload-document"] input[type="file"]').setInputFiles({
    name: 'e2e-protocol-v1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e'),
  })
  await expect(page.locator('[data-form="upload-document-review"]')).toBeVisible({ timeout: 30_000 })
  // Safety: the upload was answered by the in-page mock, never by the real API.
  expect((await hits()).upload).toBe(1)

  // the review form is a library form: category + title, no assignee / TA / output type
  const review = page.locator('[data-form="upload-document-review"]')
  await expect(review.locator('[data-source-category]')).toHaveValue('protocol')
  await expect(review.locator('input[type="radio"]')).toHaveCount(0)
  await expect(review.locator('[data-ta-select]')).toHaveCount(0)
  await review.locator('input').first().fill('E2E Protocol')   // title
  // Submit with Enter: in dev builds the "MSW: n groups" badge floats over this button and
  // swallows the click (it isn't in production builds). The button must still be enabled.
  await expect(page.getByRole('button', { name: 'Save to library' })).toBeEnabled()
  await review.locator('input').first().press('Enter')

  // drawer closes, notice shows, and we are STILL on the Source Documents tab
  await expect(page.locator('[data-upload-success]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-form="upload-document-review"]')).toHaveCount(0)
  await expect(page.locator('[data-screen="source-documents"]')).toBeVisible()
  expect(page.url()).toBe(tabUrl)
  const h = await hits()
  expect(h.save).toBe(1)
  expect(h.confirm).toBe(0)   // no Document is created by an upload

  // the notice offers (but does not force) writing a document from the file
  await expect(page.locator('[data-action="create-from-saved-source"]')).toHaveCount(0)
})

const uploadOne = async (page: Page) => {
  await page.locator('[data-action="upload-source"]').click()
  await page.locator('[data-form="upload-document"] input[type="file"]').setInputFiles({
    name: 'e2e-protocol-v1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e'),
  })
  await expect(page.locator('[data-form="upload-document-review"]')).toBeVisible({ timeout: 30_000 })
}
const hitsOf = (page: Page) => page.evaluate(() => (window as unknown as { __hits: { save: number; discard: number } }).__hits)

test('an upload that is not saved is discarded: Cancel, the cross, Esc and an outside click', async ({ page }) => {
  await mockUpload(page)
  await openTab(page)
  const before = Number(await page.locator('[data-count="files"]').innerText())
  const closers: Array<[string, () => Promise<void>]> = [
    ['Cancel upload', () => page.getByRole('button', { name: 'Cancel upload' }).click()],
    ['cross', () => page.getByRole('button', { name: 'Close panel' }).click()],
    ['Esc', () => page.keyboard.press('Escape')],
    ['outside click', () => page.locator('[data-screen="source-documents"] h2').first().click()],
  ]
  for (const [i, [label, close]] of closers.entries()) {
    await uploadOne(page)
    await close()
    await expect(page.locator('[data-form="upload-document-review"]'), label).toHaveCount(0)
    await expect.poll(async () => (await hitsOf(page)).discard, { message: label }).toBe(i + 1)
  }
  const h = await hitsOf(page)
  expect(h.save).toBe(0)                                                                      // nothing was saved
  expect(Number(await page.locator('[data-count="files"]').innerText())).toBe(before)         // library unchanged
})

test('saving to the library does not discard the upload', async ({ page }) => {
  await mockUpload(page)
  await openTab(page)
  await uploadOne(page)
  await page.locator('[data-form="upload-document-review"] input').first().press('Enter')
  await expect(page.locator('[data-upload-success]')).toBeVisible({ timeout: 30_000 })
  const h = await hitsOf(page)
  expect(h.save).toBe(1)
  expect(h.discard).toBe(0)
})

test('an outside click closes the Upload source and New document panels', async ({ page }) => {
  await openTab(page)
  const heading = page.locator('[data-screen="source-documents"] h2').first()

  await page.locator('[data-action="upload-source"]').click()
  await expect(page.locator('[data-form="upload-document"]')).toBeVisible()
  await heading.click()
  await expect(page.locator('[data-form="upload-document"]')).toHaveCount(0)

  await page.getByRole('button', { name: /New Document/ }).first().click()
  await expect(page.locator('[data-form="new-document"]')).toBeVisible()
  await heading.click()
  await expect(page.locator('[data-form="new-document"]')).toHaveCount(0)
})
