// QA regression — Editor toolbar "Insert citation" (FR-A-022): it opens the Source References panel
// with the citation form; picking a source document puts a citation such as "[Protocol_v2.pdf, p. 12]"
// in at the cursor, saved as a reference on exactly that text (so it is marked and opens its source).
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/32-insert-citation.spec.ts
//
// /auth/me, the document, its RACI, section lock, references and the project's source list are answered
// inside the page — reference links are permanent records, so a test must never write them. Any other API
// call that comes back 401 (no real session in the test) is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

const PROJECT_ID = 'PROJ-E2E-CITE'
const DOC_ID = 'DOC-E2E-CITE'
const SENTENCE = 'Median progression-free survival was 11.2 months in the treatment arm.'
const SOURCES = [
  { id: 'up-protocol', fileName: 'Protocol_v2.pdf' },
  { id: 'up-sap',      fileName: 'SAP_final.pdf' },
]

test.setTimeout(120_000)

type W = { __refPosts: Array<Record<string, unknown>>; __sectionSaves: Array<{ contentHtml?: string }>; __refStatus?: number }

async function open(page: Page, opts: { canEdit?: boolean; refStatus?: number; canViewSources?: boolean } = {}) {
  await page.addInitScript(({ docId, projectId, sentence, sources, canEdit, refStatus, canViewSources }) => {
    const w = window as unknown as W
    w.__refPosts = []
    w.__sectionSaves = []
    const refs: Array<Record<string, unknown>> = []
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    const me = { id: 'u1', email: 'me@example.com', name: 'E2E User', role: 'contributor', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (url.includes(`/projects/${projectId}/source-documents/access`)) return json({ canView: canViewSources, canUpload: false })
      if (url.includes(`/projects/${projectId}/source-documents`)) {
        return json({ items: sources.map(s => ({ ...s, contentType: 'application/pdf', previewable: true, state: 'accepted', virusScanStatus: 'clean' })), total: sources.length, page: 1, pageSize: 100 })
      }
      const m = new RegExp(`/documents/${docId}(/[^?]*)?(\\?.*)?$`).exec(url)
      if (!m) {
        const res = await real(input, init)
        return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
      }
      const sub = m[1] ?? ''
      if (sub === '' && method === 'GET') {
        return json({
          id: docId, projectId, type: 'csr-full', title: 'E2E Citation Test CSR', stage: 'post-study', status: 'in-authoring',
          version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-11-05T09:00:00Z',
          sections: [{ id: 's11_4', number: '§11.4', title: 'Efficacy Results', status: 'in-progress', contentHtml: `<p>${sentence}</p>` }],
        })
      }
      if (sub === '/raci/can-edit') return json({ canEdit })
      if (sub === '/raci' && method === 'GET') return json(canEdit ? [{ id: 'raci-me', documentId: docId, userId: 'u1', letter: 'R', sectionId: null, removedAt: null }] : [])
      if (/^\/sections\/[^/]+\/lock$/.test(sub)) {
        return method === 'DELETE' ? json({ released: true })
          : json({ outcome: 'acquired', holder: { userId: 'u1', acquiredAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(), expiresInSeconds: 90 }, staleSeconds: 90 })
      }
      if (sub === '/references' && method === 'GET') return json({ projectId, items: refs })
      if (sub === '/references' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        w.__refPosts.push(body)
        if (refStatus) return json({ error: 'forbidden', message: 'Only the document’s authors can link sources.' }, refStatus)
        const row = {
          id: `ref-${refs.length + 1}`, documentId: docId, ...body, fileName: sources.find(s => s.id === body.uploadId)?.fileName ?? null,
          contentType: 'application/pdf', previewable: true, page: body.page ?? null, locator: body.locator ?? null,
          createdBy: { id: 'u1', name: 'E2E User' }, createdAt: new Date().toISOString(),
        }
        refs.push(row)
        return json(row, 201)
      }
      if (/^\/sections\/[^/]+$/.test(sub) && method === 'PATCH') {
        w.__sectionSaves.push(JSON.parse(String(init?.body ?? '{}')))
        return json({})
      }
      if (sub.includes('presence')) return json({ documentId: docId, sections: [] })
      if (sub === '/ai-draft-status') return json({ state: 'idle', confidenceOverall: null, sections: [], lastPassNumber: 0 })
      return json(sub === '/versions' || sub.endsWith('s') ? [] : {})
    }
  }, { docId: DOC_ID, projectId: PROJECT_ID, sentence: SENTENCE, sources: SOURCES, canEdit: opts.canEdit ?? true, refStatus: opts.refStatus ?? 0, canViewSources: opts.canViewSources ?? true })
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/documents/${DOC_ID}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-section-content]')).toContainText(SENTENCE, { timeout: 60_000 })
}

const button = (page: Page) => page.locator('[data-action="insert-citation"]')

/** Put the cursor at the end of the sentence, the way a writer would. */
async function cursorAfterSentence(page: Page) {
  await page.locator('[data-section-editor] .ProseMirror').getByText(SENTENCE).click()
  await page.keyboard.press('End')
}

test('the button is live (no SOON badge) and opens the citation form in the Source References panel', async ({ page }) => {
  await open(page)
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await expect(button(page)).toHaveText('Insert citation')
  // the formatting buttons are live too, before any click in the text (they used to stay grey until then)
  await expect(page.getByTitle(/bold/i)).toBeEnabled()
  await button(page).click()
  await expect(page.locator('[data-panel="source-references"] [data-citation-form]')).toBeVisible()
  await expect(button(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-action="confirm-insert-citation"]')).toBeDisabled()   // no source yet
  const options = page.locator('[data-field="citation-source"] option')
  await expect(options).toHaveCount(SOURCES.length + 1)
  await expect(options.nth(1)).toHaveText('Protocol_v2.pdf')
})

test('inserting puts the citation in at the cursor and links that exact text to the source', async ({ page }) => {
  await open(page)
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await cursorAfterSentence(page)
  await button(page).click()

  await page.locator('[data-field="citation-source"]').selectOption('up-protocol')
  await page.locator('[data-field="citation-page"]').fill('12')
  await expect(page.locator('[data-citation-preview]')).toContainText('[Protocol_v2.pdf, p. 12]')
  await page.locator('[data-action="confirm-insert-citation"]').click()

  // in the section, after the sentence, with a space before it
  await expect(page.locator('[data-section-editor]')).toContainText(`${SENTENCE} [Protocol_v2.pdf, p. 12]`)

  // saved as a reference on exactly the citation text
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__refPosts.length)).toBe(1)
  const [post] = await page.evaluate(() => (window as unknown as W).__refPosts) as Array<{ startOffset: number; endOffset: number }>
  expect(post).toMatchObject({ sectionId: 's11_4', spanText: '[Protocol_v2.pdf, p. 12]', uploadId: 'up-protocol', page: 12 })
  expect(post!.endOffset - post!.startOffset).toBe('[Protocol_v2.pdf, p. 12]'.length)

  // back to the list, which shows it
  await expect(page.locator('[data-citation-form]')).toHaveCount(0)
  await expect(page.locator('[data-reference]')).toHaveCount(1)
  await expect(page.locator('[data-reference]')).toContainText('Protocol_v2.pdf')

  // and the section is saved with the citation in it
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__sectionSaves.some(s => (s.contentHtml ?? '').includes('[Protocol_v2.pdf, p. 12]'))), { timeout: 15_000 }).toBe(true)

  // the citation is marked as reference-linked text
  if (await page.evaluate(() => typeof CSS !== 'undefined' && 'highlights' in CSS)) {
    await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('source-ref'))).toBe(true)
  }
})

test('a locator goes in the citation too', async ({ page }) => {
  await open(page)
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await cursorAfterSentence(page)
  await button(page).click()
  await page.locator('[data-field="citation-source"]').selectOption('up-sap')
  await page.locator('[data-field="citation-locator"]').fill('Table 14.2.1')
  await page.locator('[data-action="confirm-insert-citation"]').click()
  await expect(page.locator('[data-section-editor]')).toContainText('[SAP_final.pdf, Table 14.2.1]')
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__refPosts[0]?.locator)).toBe('Table 14.2.1')
})

test('if the reference cannot be saved, the citation comes out of the section and the reason shows', async ({ page }) => {
  await open(page, { refStatus: 403 })
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await cursorAfterSentence(page)
  await button(page).click()
  await page.locator('[data-field="citation-source"]').selectOption('up-protocol')
  await page.locator('[data-action="confirm-insert-citation"]').click()

  await expect(page.locator('[data-citation-error]')).toContainText('Only the document’s authors can link sources.')
  await expect(page.locator('[data-section-editor]')).not.toContainText('[Protocol_v2.pdf]')
  await expect(page.locator('[data-section-editor]')).toContainText(SENTENCE)
  await expect(page.locator('[data-citation-form]')).toBeVisible()      // the author can try again or cancel
})

test('Cancel leaves the section untouched and shows the normal references panel', async ({ page }) => {
  await open(page)
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await button(page).click()
  await page.locator('[data-action="cancel-insert-citation"]').click()
  await expect(page.locator('[data-citation-form]')).toHaveCount(0)
  await expect(page.locator('[data-reference-form]')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as W).__refPosts.length)).toBe(0)
})

test('picking "Source References" from the Reference menu shows the normal panel, not the citation form', async ({ page }) => {
  await open(page)
  await expect(button(page)).toBeEnabled({ timeout: 30_000 })
  await button(page).click()
  await expect(page.locator('[data-citation-form]')).toBeVisible()
  await page.locator('[data-reference-toggle]').click()
  await page.locator('[data-reference-option="traceability"]').click()
  await expect(page.locator('[data-citation-form]')).toHaveCount(0)
  await expect(page.locator('[data-reference-form]')).toBeVisible()
})

test('someone who may not edit the document gets a disabled button', async ({ page }) => {
  await open(page, { canEdit: false })
  await expect(button(page)).toBeDisabled()
  await expect(button(page)).toHaveAttribute('title', 'Open the section for editing to insert a citation')
})

test('someone who may not view the project’s sources does not get the button', async ({ page }) => {
  await open(page, { canViewSources: false })
  await expect(page.locator('[data-reference-toggle]')).toBeVisible({ timeout: 30_000 })
  await expect(button(page)).toHaveCount(0)
})
