// Several source files can be picked (or dropped) at once: each gets its own card, they upload one after another,
// and "Save" saves them together.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/59-source-upload-multiple.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const ME = {
  id: 'u-author', email: 'author@example.com', name: 'An Author', role: 'contributor', roles: ['contributor'],
  allRoles: ['contributor'], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null,
}
interface Log { uploads: string[]; atOnce: number; maxAtOnce: number; saves: Array<{ id: string; title: string; category: string }>; discards: string[]; failSave: string | null }
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: Log }).__log)

async function open(page: Page) {
  await page.addInitScript(({ me }) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const w = window as unknown as { __log: Log }
    w.__log = { uploads: [], atOnce: 0, maxAtOnce: 0, saves: [], discards: [], failSave: null }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      if (/\/projects\/p-e2e$/.test(p)) return json({ id: 'p-e2e', name: 'E2E', status: 'ongoing', team: [], documents: [] })
      if (p.endsWith('/source-documents/access')) return json({ canView: true, canUpload: true })
      const save = /\/source-documents\/([^/]+)\/save$/.exec(p)
      if (save) {
        if (w.__log.failSave === save[1]) { w.__log.failSave = null; return json({ error: 'boom' }, 500) }
        w.__log.saves.push({ id: save[1]!, ...JSON.parse(String(init?.body)) })
        return json({ id: save[1] })
      }
      const one = /\/source-documents\/([^/]+)$/.exec(p)
      if (one && init?.method === 'DELETE') { w.__log.discards.push(one[1]!); return new Response(null, { status: 204 }) }
      if (p.endsWith('/source-documents')) return json({ items: [], rows: [], total: 0, summary: { files: 0 } })
      return json([])
    }
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const name = ((body as FormData).get('file') as File).name
      const l = w.__log
      l.uploads.push(name)
      l.atOnce++
      l.maxAtOnce = Math.max(l.maxAtOnce, l.atOnce)
      setTimeout(() => {
        l.atOnce--
        const refused = name.startsWith('refused')
        Object.defineProperty(this, 'status', { value: refused ? 400 : 200 })
        Object.defineProperty(this, 'responseText', { value: JSON.stringify(refused
          ? { error: 'bad', message: 'This file is damaged.' }
          : { uploadId: `up-${name}`, fileName: name, fileSizeMB: 0.01, virusScanStatus: 'passed',
              classification: { sourceCategory: name.startsWith('sap') ? 'sap' : 'protocol', sourceCategoryConfidence: 90, version: '', versionConfidence: 0, stub: false } }) })
        this.dispatchEvent(new Event('load'))
      }, 150)
    }
  }, { me: ME })
  await page.goto('/projects/p-e2e/clinical-writing')
  await page.locator('[data-action="upload-source"]').first().click({ timeout: 60_000 })
}

const pick = (page: Page, ...names: string[]) =>
  page.locator('[data-form="upload-document"] input[type="file"]')
    .setInputFiles(names.map(name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })))
const card = (page: Page, name: string) => page.locator(`[data-upload-file="${name}"]`)
const submit = (page: Page) => card(page, 'a.pdf').locator('input').first().press('Enter')

test('three files upload one after another, each with its own details, and are saved together', async ({ page }) => {
  await open(page)
  await pick(page, 'a.pdf', 'sap-b.pdf', 'c.pdf')
  await expect(page.locator('[data-upload-status="ready"]')).toHaveCount(3, { timeout: 30_000 })
  await expect(card(page, 'sap-b.pdf').locator('[data-source-category]')).toHaveValue('sap')
  await expect(card(page, 'a.pdf').locator('[data-source-category]')).toHaveValue('protocol')
  await card(page, 'c.pdf').locator('input').first().fill('Renamed C')
  await expect(page.getByRole('button', { name: 'Save 3 files to library' })).toBeEnabled()
  await submit(page)

  await expect(page.locator('[data-upload-success]')).toHaveText(/3 source documents saved/)
  const l = await log(page)
  expect(l.uploads).toEqual(['a.pdf', 'sap-b.pdf', 'c.pdf'])
  expect(l.maxAtOnce).toBe(1)
  expect(l.saves.map(s => [s.id, s.title, s.category])).toEqual([
    ['up-a.pdf', 'a', 'protocol'], ['up-sap-b.pdf', 'sap-b', 'sap'], ['up-c.pdf', 'Renamed C', 'protocol'],
  ])
  expect(l.discards).toEqual([])
})

test('a refused file says why and does not stop the others; a removed one is discarded', async ({ page }) => {
  await open(page)
  await pick(page, 'a.pdf', 'refused.pdf', 'notes.exe', 'c.pdf')
  await expect(page.locator('[data-upload-status="ready"]')).toHaveCount(2, { timeout: 30_000 })
  await expect(card(page, 'refused.pdf')).toContainText('This file is damaged.')
  await expect(card(page, 'notes.exe')).toHaveAttribute('data-upload-status', 'failed')
  expect((await log(page)).uploads).not.toContain('notes.exe')

  await card(page, 'c.pdf').locator('[data-action="remove-file"]').click()
  await expect(card(page, 'c.pdf')).toHaveCount(0)
  await expect.poll(async () => (await log(page)).discards).toEqual(['up-c.pdf'])
  await submit(page)
  await expect(page.locator('[data-upload-success]')).toBeVisible()
  const l = await log(page)
  expect(l.saves.map(s => s.id)).toEqual(['up-a.pdf'])
  expect(l.discards).toEqual(['up-c.pdf'])
})

test('when one save fails the rest are kept, and saving again saves only that one', async ({ page }) => {
  await open(page)
  await pick(page, 'a.pdf', 'c.pdf')
  await expect(page.locator('[data-upload-status="ready"]')).toHaveCount(2, { timeout: 30_000 })
  await page.evaluate(() => { (window as unknown as { __log: Log }).__log.failSave = 'up-a.pdf' })
  await submit(page)
  await expect(card(page, 'c.pdf')).toHaveAttribute('data-upload-status', 'saved')
  await expect(card(page, 'a.pdf')).toContainText('Could not save (HTTP 500)')

  await submit(page)
  await expect(page.locator('[data-upload-success]')).toHaveText(/2 source documents saved/)
  expect((await log(page)).saves.map(s => s.id)).toEqual(['up-c.pdf', 'up-a.pdf'])
})

test('closing without saving discards every uploaded file', async ({ page }) => {
  await open(page)
  await pick(page, 'a.pdf', 'c.pdf')
  await expect(page.locator('[data-upload-status="ready"]')).toHaveCount(2, { timeout: 30_000 })
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await log(page)).discards.sort()).toEqual(['up-a.pdf', 'up-c.pdf'])
  expect((await log(page)).saves).toEqual([])
})

test('when nothing chosen can be uploaded, the drop area stays with the reasons', async ({ page }) => {
  await open(page)
  await pick(page, 'x.exe', 'y.exe')
  await expect(page.getByText('Drop files here')).toBeVisible()
  await expect(page.locator('[data-form="upload-document"] [role="alert"]')).toContainText('x.exe')
  await expect(page.locator('[data-form="upload-document"] [role="alert"]')).toContainText('y.exe')
})
