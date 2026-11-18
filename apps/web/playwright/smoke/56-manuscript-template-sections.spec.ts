// QA — Module B "Edit sections" with the Original Research Manuscript template (docs/templates/
// manuscript-original-research.template.json). Sections show formatted (sub-headings, placeholders, table shells)
// instead of raw HTML, in number order, with the template's drafting guidance; an edit saves HTML on blur.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/56-manuscript-template-sections.spec.ts

import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

test.setTimeout(120_000)

const TEMPLATE = JSON.parse(readFileSync(new URL('../../../../docs/templates/manuscript-original-research.template.json', import.meta.url), 'utf8')) as {
  sections: Array<{ id: string; number: string; title: string; guidance?: string; starterHtml: string }>
}
const ME = { id: 'u-w', email: 'w@example.com', name: 'Wendy Writer', role: 'contributor', modules: ['B'], status: 'active', lastActiveAt: null, tenantId: 't1' }
const PUB = 'pub-e2e'
const BASE = `/projects/p-e2e/scientific-writing/publications/${PUB}/edit`
const SECTIONS = TEMPLATE.sections.map(s => ({
  id: `c-${s.id}`, sectionId: s.id, sectionNumber: s.number, sectionTitle: s.title, guidance: s.guidance ?? null,
  contentHtml: s.starterHtml, wordCount: 10, aiConfidence: null, aiFlags: [], lastEditedBy: null, lastEditedAt: null,
}))

test('the template opens formatted, in order, with drafting guidance, and an edit saves on blur', async ({ page }) => {
  await page.addInitScript(({ me, pub, sections }) => {
    const w = window as unknown as { __saves: Array<{ sectionId: string; html: string }> }
    w.__saves = []
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      const m = (init?.method ?? 'GET').toUpperCase()
      if (p.endsWith('/auth/me')) return json(me)
      if (p.endsWith(`/publications/${pub}/sections`) && m === 'GET') return json({ publicationId: pub, sections })
      const save = p.match(new RegExp(`/publications/${pub}/sections/([^/]+)$`))
      if (save && m === 'PATCH') {
        const html = (JSON.parse(String(init!.body)) as { contentHtml: string }).contentHtml
        w.__saves.push({ sectionId: decodeURIComponent(save[1]!), html })
        return json({ id: 'x', sectionId: save[1], contentHtml: html, wordCount: 1, lastEditedAt: new Date().toISOString() })
      }
      if (/\/sections\/[^/]+\/lock$/.test(p)) return json({ outcome: 'acquired', expiresInSeconds: 120 })
      if (p.endsWith(`/publications/${pub}/locks`)) return json({ locks: [] })
      if (/\/sections\/[^/]+\/comments$/.test(p)) return json([])
      if (p.endsWith(`/publications/${pub}`)) return json({ id: pub, projectId: 'p-e2e', title: 'Trial X manuscript', type: 'manuscript', subtype: 'original_research', aiDraftState: 'idle', aiInstructions: null })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me: ME, pub: PUB, sections: SECTIONS })
  await page.goto(BASE)

  const editors = page.locator('[data-section-editor]')
  await expect(editors).toHaveCount(11, { timeout: 60_000 })
  // Number order: Tables and figures (10) and the traceability log (12) come last, not after the Title page.
  const order = await editors.evaluateAll(els => els.map(e => e.getAttribute('data-section-editor')))
  expect(order).toEqual(['title', 'abstract', 'intro', 'methods', 'results', 'discussion', 'conclusion', 'declarations', 'references', 'tables_figures', 'traceability'])

  // Formatted, not raw tags: Methods shows its sub-headings as headings; Tables shows real tables.
  const methods = page.locator('[data-field="content-methods"]')
  await expect(methods.locator('h3', { hasText: '4.1 Study design and oversight' })).toBeVisible()
  await expect(methods).not.toContainText('<h3>')
  await expect(page.locator('[data-field="content-tables_figures"] table')).toHaveCount(3)
  await page.locator('[data-section-editor="methods"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/manuscript-template-methods.png' })
  await page.locator('[data-section-editor="tables_figures"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/manuscript-template-tables.png' })

  // Drafting guidance from the template.
  await expect(page.locator('[data-section-editor="results"] [data-section-guidance]')).toContainText('Do not fabricate values')

  // Edit the Conclusion and click away: it saves as HTML.
  const conclusion = page.locator('[data-field="content-conclusion"] .tiptap-editor')
  await conclusion.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Drug X improved the primary outcome.')
  await page.locator('h1, h2').first().click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saves: Array<{ sectionId: string; html: string }> }).__saves)).toEqual([
    { sectionId: 'conclusion', html: '<p>Drug X improved the primary outcome.</p>' },
  ])
})
