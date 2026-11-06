// QA regression — a document with no sections says so, and its author or a PM can apply the template.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/40-apply-template-sections.spec.ts
//
// Everything is answered inside the page, so no document changes. The rules are in
// apps/api/src/modules/clinical-writing/documents/apply-template.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-TPL'
const DOC = 'DOC-E2E-TPL'

type Stub = { role?: string; letter?: string | null; refuse?: { status: number; error: string }; language?: string; status?: string }

async function open(page: Page, stub: Stub = {}, landing = '[data-empty-document]') {
  await page.addInitScript(({ project, doc, stub }) => {
    localStorage.setItem('clinwrite.uiLanguage', stub.language ?? 'en')
    const w = window as unknown as { __applied: number }
    w.__applied = 0
    const role = stub.role ?? 'pm'
    const me = { id: 'u-me', email: 'me@x.test', name: 'Mia Me', role, modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    let sections: unknown[] = []
    const document = () => ({
      id: doc, projectId: project, type: 'protocol', title: 'Old Protocol', status: stub.status ?? 'not-started', stage: 'study-start-up', version: 'v0.1',
      therapeuticArea: 'Oncology', assigneeId: 'someone', createdAt: '2026-10-22T09:00:00Z', updatedAt: '2026-10-22T09:00:00Z', watermarked: true, sections,
    })
    const raci = stub.letter ? [{ id: 'r1', documentId: doc, userId: 'u-me', userName: 'Mia Me', letter: stub.letter, removedAt: null }] : []
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes(`/documents/${doc}/apply-template`)) {
        w.__applied++
        if (stub.refuse) return json({ error: stub.refuse.error, message: 'server words' }, stub.refuse.status)
        sections = [{ id: 's1', number: '1', title: 'Protocol Summary', status: 'not-started', contentHtml: '' }, { id: 's2', number: '2', title: 'Introduction', status: 'not-started', contentHtml: '' }]
        return json({ sectionCount: 2 }, 201)
      }
      if (url.includes(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: stub.letter === 'R' })
      if (url.includes(`/documents/${doc}/raci`)) return json(raci)
      if (url.includes(`/documents/${doc}/ai-draft-status`)) return json({ sections: [], status: 'none' })
      if (url.includes(`/documents/${doc}/presence`)) return json({ sessionId: 'p1', viewers: [], sections: [], users: [], heartbeatSeconds: 60 })
      if (new RegExp(`/documents/${doc}(\\?.*)?$`).test(url)) return json(method === 'GET' ? document() : {})
      if (url.includes(`/documents/${doc}/`)) return json([])
      if (new RegExp(`/projects/${project}(\\?.*)?$`).test(url)) return json({ id: project, name: 'Old', shortTitle: 'Old', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], submissionCountries: [], team: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' })
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json([], 200)
      return real(input, init)
    }
  }, { project: PROJECT, doc: DOC, stub })
  await page.goto(`/projects/${PROJECT}/clinical-writing/documents/${DOC}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(landing)).toBeVisible({ timeout: 60_000 })
}

const button = (page: Page) => page.locator('[data-action="apply-template-sections"]')
const applied = (page: Page) => page.evaluate(() => (window as unknown as { __applied: number }).__applied)

test('a PM applies the template, and the sections appear', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-empty-document]')).toContainText('no sections yet')
  await button(page).click()
  await expect(page.locator('[data-empty-document]')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Protocol Summary').first()).toBeVisible()
  expect(await applied(page)).toBe(1)
})

test('an author (R) gets the action too', async ({ page }) => {
  await open(page, { role: 'contributor', letter: 'R' })
  await expect(button(page)).toBeVisible()
})

test('Informed (I) is told who can do it, with no button', async ({ page }) => {
  await open(page, { role: 'contributor', letter: 'I' })
  await expect(page.locator('[data-apply-template-unavailable]')).toContainText('project manager')
  await expect(button(page)).toHaveCount(0)
})

test('a Reviewer (C) opens the Reviewer View, which says there are no sections, with no button', async ({ page }) => {
  await open(page, { role: 'contributor', letter: 'C' }, '[data-screen="reviewer-view"]')
  await expect(page.locator('[data-screen="reviewer-view"]')).toContainText('no sections yet')
  await expect(button(page)).toHaveCount(0)
})

test('a PM can apply it to a document already in review', async ({ page }) => {
  await open(page, { status: 'in-review' })
  await expect(button(page)).toBeVisible()
})

test('the section list says the document has no sections, not that none match', async ({ page }) => {
  await open(page)
  await expect(page.getByText('This document has no sections yet.').first()).toBeVisible()
  await expect(page.getByText('No sections match')).toHaveCount(0)
})

test('a refusal is explained', async ({ page }) => {
  await open(page, { refuse: { status: 422, error: 'no_template' } })
  await button(page).click()
  await expect(page.locator('[data-apply-template-error]')).toHaveText('There is no template for this document type.')
})

test('it is Japanese in Japanese', async ({ page }) => {
  await open(page, { language: 'ja' })
  await expect(button(page)).toHaveText('テンプレートのセクションを適用')
})
