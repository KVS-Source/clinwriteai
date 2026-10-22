// QA regression — reference links from document text to uploaded source documents (PRD FR-A-022)
// and the right-hand source viewer (PDF / image).
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/09-source-references.spec.ts
//
// The document and its reference-link records are answered inside the page (the real database has no
// editable document, and reference links are immutable by design, so a test must never write them).
// Source files are the project's REAL uploads: the viewer calls the live /preview endpoint, which only
// reads. Tests that need a particular real file skip when the project does not have it.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const DOC_ID = 'DOC-E2E-REFS'
const SENTENCE = 'Median progression-free survival was 11.2 months in the treatment arm.'

test.setTimeout(120_000)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ docId, projectId, sentence }) => {
    const refs: Array<Record<string, unknown>> = []
    const w = window as unknown as { __refPosts: Array<Record<string, unknown>> }
    w.__refPosts = []
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
      const m = new RegExp(`/documents/${docId}(/[^?]*)?(\\?.*)?$`).exec(url)
      if (!m) return realFetch(input, init)
      const sub = m[1] ?? ''
      if (sub === '' && method === 'GET') {
        return json({
          id: docId, projectId, type: 'csr-full', title: 'E2E Reference Test CSR', status: 'in-authoring', stage: 'post-study',
          version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: 'u1', updatedAt: '2026-10-22T09:00:00Z',
          sections: [{ id: 's11_4', number: '§11.4', title: 'Efficacy Results', status: 'in-progress', contentHtml: `<p>${sentence}</p><p>No other efficacy endpoints were reported.</p>` }],
        })
      }
      if (sub === '/references' && method === 'GET') return json({ projectId, items: refs })
      if (sub === '/references' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        w.__refPosts.push(body)
        const row = {
          id: `ref-${refs.length + 1}`, documentId: docId, ...body, fileName: body.fileName ?? null, contentType: 'application/pdf',
          previewable: true, page: body.page ?? null, locator: body.locator ?? null,
          createdBy: { id: 'u1', name: 'E2E User' }, createdAt: new Date().toISOString(),
        }
        // resolve the file name the way the server does
        const upload = (window as unknown as { __sources?: Array<{ id: string; fileName: string }> }).__sources?.find(s => s.id === body.uploadId)
        row.fileName = upload?.fileName ?? row.fileName
        refs.push(row)
        return json(row, 201)
      }
      if (sub.includes('presence')) return json({ documentId: docId, sections: [] })
      return json(sub === '/versions' || sub.endsWith('s') ? [] : {})
    }
  }, { docId: DOC_ID, projectId: PROJECT_ID, sentence: SENTENCE })
})

async function openEditor(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing/documents/${DOC_ID}`)
  await expect(page.locator('[data-section-content]')).toContainText(SENTENCE, { timeout: 60_000 })
}

/** Select the sentence the way a user would, so the real selectionchange path runs. */
async function selectSentence(page: Page) {
  await page.evaluate((sentence) => {
    const root = document.querySelector('[data-section-content]')!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue ?? '').indexOf(sentence)
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(n, i); r.setEnd(n, i + sentence.length)
        const sel = window.getSelection()!
        sel.removeAllRanges(); sel.addRange(r)
        return
      }
    }
    throw new Error('sentence not found')
  }, SENTENCE)
}

async function openPanel(page: Page) {
  await page.locator('[data-reference-toggle]').click()
  await page.locator('[data-reference-option="traceability"]').click()
  await expect(page.locator('[data-panel="source-references"]')).toBeVisible()
  // let the real source list arrive and share it with the in-page mock
  await expect(page.locator('[data-field="source"] option').nth(1)).toBeAttached({ timeout: 60_000 })
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll<HTMLOptionElement>('[data-field="source"] option')].filter(o => o.value)
    ;(window as unknown as { __sources: unknown }).__sources = opts.map(o => ({ id: o.value, fileName: o.textContent }))
  })
}

const sourceValue = (page: Page, fileName: string, idPrefix?: string) =>
  page.evaluate(({ fileName, idPrefix }) => {
    const opts = [...document.querySelectorAll<HTMLOptionElement>('[data-field="source"] option')]
    return opts.find(o => o.textContent === fileName && (!idPrefix || o.value.startsWith(idPrefix)))?.value ?? null
  }, { fileName, idPrefix })

test('Reference menu offers "Source References" and opens the right panel', async ({ page }) => {
  await openEditor(page)
  await page.locator('[data-reference-toggle]').click()
  await expect(page.locator('[data-reference-option="traceability"]')).toContainText('Source References')
  await page.locator('[data-reference-option="traceability"]').click()
  await expect(page.locator('[data-panel="source-references"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Source References', level: 3 })).toBeVisible()
  await expect(page.locator('[data-reference-empty]')).toBeVisible()
})

test('selected text shows in the panel, and Add reference needs both text and a source', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)
  await expect(page.locator('[data-selected-empty]')).toBeVisible()
  await expect(page.locator('[data-action="add-reference"]')).toBeDisabled()

  await selectSentence(page)
  await expect(page.locator('[data-selected-text]')).toContainText('Median progression-free survival')
  await expect(page.locator('[data-action="add-reference"]')).toBeDisabled()   // still no source

  await page.locator('[data-field="source"]').selectOption({ index: 1 })
  await expect(page.locator('[data-action="add-reference"]')).toBeEnabled()

  await page.locator('[data-action="clear-selection"]').click()
  await expect(page.locator('[data-action="add-reference"]')).toBeDisabled()
})

test('adding a reference lists it, marks the text, counts it, and cannot be edited or deleted', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)
  const pdf = await sourceValue(page, 'SHCO-Standards-3rd-Edition.pdf', 'e44ea249')
  test.skip(!pdf, 'project does not have the expected real PDF')

  await selectSentence(page)
  await page.locator('[data-field="source"]').selectOption(pdf!)
  await page.locator('[data-field="page"]').fill('3')
  await page.locator('[data-field="locator"]').fill('§9.4 Table 3')
  await page.locator('[data-action="add-reference"]').click()

  const item = page.locator('[data-reference]').first()
  await expect(item).toContainText('Median progression-free survival')
  await expect(item).toContainText('SHCO-Standards-3rd-Edition.pdf')
  await expect(item).toContainText('p. 3')
  await expect(item).toContainText('§9.4 Table 3')
  await expect(page.locator('[data-reference-count]')).toHaveText('1')
  await expect(page.locator('[data-provenance-bar]')).toContainText('1 source reference')
  // form resets after a successful add
  await expect(page.locator('[data-selected-empty]')).toBeVisible()

  // what was sent to the API
  const posts = await page.evaluate(() => (window as unknown as { __refPosts: unknown[] }).__refPosts)
  expect(posts).toEqual([{ sectionId: 's11_4', spanText: SENTENCE, uploadId: pdf, page: 3, locator: '§9.4 Table 3' }])

  // immutable: the only action on a reference is "View source"
  await expect(item.getByRole('button')).toHaveCount(1)
  await expect(item.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0)

  // the cited sentence is marked in the section (CSS Custom Highlight API)
  const supported = await page.evaluate(() => typeof CSS !== 'undefined' && 'highlights' in CSS)
  if (supported) await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('source-ref'))).toBe(true)
})

test('View source opens the real PDF in the right panel at the cited page, with the cited text', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)
  const pdf = await sourceValue(page, 'SHCO-Standards-3rd-Edition.pdf', 'e44ea249')
  test.skip(!pdf, 'project does not have the expected real PDF')

  await selectSentence(page)
  await page.locator('[data-field="source"]').selectOption(pdf!)
  await page.locator('[data-field="page"]').fill('3')
  await page.locator('[data-action="add-reference"]').click()
  await page.locator('[data-action="open-source"]').first().click()

  const frame = page.locator('[data-viewer-frame]')
  await expect(frame).toBeVisible({ timeout: 60_000 })
  expect(await frame.getAttribute('src')).toMatch(/^blob:.*#page=3$/)
  await expect(page.locator('[data-viewer-quote]')).toContainText('Median progression-free survival')
  await expect(page.locator('[data-viewer-page]')).toHaveValue('3')

  // jump to another page
  await page.locator('[data-viewer-page]').fill('7')
  await expect(frame).toHaveAttribute('src', /#page=7$/)

  // the editor stays visible beside the viewer; Back returns to the list
  await expect(page.locator('[data-section-content]')).toContainText(SENTENCE)
  await page.locator('[data-action="viewer-back"]').click()
  await expect(page.locator('[data-reference]')).toHaveCount(1)
})

test('clicking the marked text in the section opens its source', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)
  const pdf = await sourceValue(page, 'SHCO-Standards-3rd-Edition.pdf', 'e44ea249')
  test.skip(!pdf, 'project does not have the expected real PDF')
  test.skip(!(await page.evaluate(() => typeof CSS !== 'undefined' && 'highlights' in CSS)), 'browser lacks the Custom Highlight API')

  await selectSentence(page)
  await page.locator('[data-field="source"]').selectOption(pdf!)
  await page.locator('[data-field="page"]').fill('5')
  await page.locator('[data-action="add-reference"]').click()
  await expect(page.locator('[data-reference]')).toHaveCount(1)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())

  // click in the middle of the linked sentence
  const pt = await page.evaluate((sentence) => {
    const root = document.querySelector('[data-section-content]')!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue ?? '').indexOf(sentence)
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i + 10); r.setEnd(n, i + 12)
        const b = r.getBoundingClientRect()
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      }
    }
    return null
  }, SENTENCE)
  await page.mouse.click(pt!.x, pt!.y)
  await expect(page.locator('[data-source-viewer]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-viewer-quote]')).toContainText('Median progression-free survival')

  // clicking unlinked text does nothing
  await page.locator('[data-action="viewer-back"]').click()
  await page.getByText('No other efficacy endpoints were reported.').click()
  await expect(page.locator('[data-source-viewer]')).toHaveCount(0)
})

test('Word/Excel files say they cannot be previewed; a file missing from storage says so', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  const docx = page.locator('[data-source-item]', { hasText: '.docx' }).first()
  if (await docx.count()) {
    await docx.locator('[data-action="open-project-source"]').click()
    await expect(page.locator('[data-viewer-state="not-previewable"]')).toContainText('only PDF and image')
    await expect(page.locator('[data-viewer-frame]')).toHaveCount(0)
    await page.locator('[data-action="viewer-back"]').click()
  }

  // a PDF row whose bytes are gone from storage (uploaded from another environment)
  const missing = await sourceValue(page, 'SHCO-Standards-3rd-Edition.pdf', '731d3f80')
  if (missing) {
    await page.locator(`[data-source-item="${missing}"] [data-action="open-project-source"]`).click()
    await expect(page.locator('[data-viewer-state="error"]')).toContainText(/could not be found/i, { timeout: 60_000 })
  }
  test.skip(!(await docx.count()) && !missing, 'project has neither a Word file nor a missing-file row')
})

test('closing the panel closes the viewer', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)
  await page.locator('[data-source-item] [data-action="open-project-source"]').first().click()
  await expect(page.locator('[data-source-viewer]')).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await page.locator('[data-reference-toggle]').click()
  await page.locator('[data-reference-option="traceability"]').click()
  await expect(page.locator('[data-source-viewer]')).toHaveCount(0)
  await expect(page.locator('[data-reference-empty]')).toBeVisible()
})
