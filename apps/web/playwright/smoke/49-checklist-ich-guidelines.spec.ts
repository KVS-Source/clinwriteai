// QA regression — the Checklist panel's "ICH Guidelines" tab shows the ICH guidelines the document is built on, taken from the ICH
// Frameworks registry (the real ICH list synced from ich.org): the code, title, ICH step and date, and a link to
// the official text. "ICH E6" in the checklist resolves to the registry's current revision, ICH E6(R3).
//
//   E2E_BASE_URL=http://localhost:5173 E2E_DOC=PROJECT/DOCUMENT E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/49-checklist-ich-guidelines.spec.ts
//
// The checklist and the registry are answered inside the page; nothing is written.

import { test, expect } from '@playwright/test'

const DOC = process.env.E2E_DOC
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)
test.skip(!DOC, 'set E2E_DOC to PROJECT/DOCUMENT')

test('the checklist lists the ICH guidelines used, with their registry details', async ({ page }) => {
  const [projectId, documentId] = DOC!.split('/')
  await page.addInitScript(({ persona, documentId }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const item = (id: string, framework: string) => ({ id, text: `Item ${id}`, framework, frameworkMandatory: true, status: 'pending', stage: 'study_start_up', sortOrder: 0 })
    const registry = [
      { id: 'f-e3', name: 'ICH E3', description: 'Structure and Content of Clinical Study Reports', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', effectiveDate: '1995-11-30', retiredAt: null, sourceUrl: 'https://database.ich.org/sites/default/files/E3_Guideline.pdf', updatedAt: '2026-11-13' },
      { id: 'f-e6', name: 'ICH E6(R3)', description: 'Good Clinical Practice (GCP)', jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', effectiveDate: '2025-01-06', retiredAt: null, sourceUrl: 'https://database.ich.org/e6r3.pdf', updatedAt: '2026-11-13' },
      { id: 'f-e6a', name: 'ICH E6(R3) Good Clinical Practice (GCP) Annex 2', description: null, jurisdiction: 'ICH', version: 'Step 5', category: 'efficacy', effectiveDate: '2025-01-06', retiredAt: null, sourceUrl: null, updatedAt: '2026-11-13' },
    ]
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/documents/${documentId}/checklist/access`)) return json({ canView: true })
      if (new RegExp(`/documents/${documentId}/checklist(\?.*)?$`).test(url)) return json([item('1', 'ICH E6'), { ...item('2', 'ICH E6 §6.2'), status: 'complete' }, item('3', 'ICH E9'), item('4', 'SOP')])
      if (/\/admin\/frameworks(\?|$)/.test(url)) return json(registry)
      if (url.includes('/presence') && (init?.method ?? 'GET').toUpperCase() !== 'GET') return json({})
      return real(input, init)
    }
  }, { persona: PM_PERSONA, documentId })
  await page.goto(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-action="toolbar-checklist"] button').click({ timeout: 60_000 })

  const tab = page.locator('[data-checklist-tab="guidelines"]')
  await expect(tab).toHaveText('ICH Guidelines (3)', { timeout: 30_000 })
  await tab.click()
  const box = page.locator('[data-ich-guidelines]')
  await expect(box.locator('[data-ich-guideline]')).toHaveCount(3)
  const e6 = box.locator('[data-ich-guideline="ICH E6(R3)"]')
  await expect(e6.locator('[data-ich-title]')).toHaveText('Good Clinical Practice (GCP)')
  await expect(e6.locator('[data-ich-meta]')).toHaveText('ICH Step 5 · 6 Jan 2025')
  await expect(e6.locator('[data-ich-source]')).toHaveAttribute('href', 'https://database.ich.org/e6r3.pdf')
  await expect(e6.locator('[data-ich-cited]')).toContainText('ICH E6, ICH E6 §6.2')
  await expect(box.locator('[data-ich-guideline="ICH E3"] [data-ich-title]')).toHaveText('Structure and Content of Clinical Study Reports')
  await expect(box.locator('[data-ich-guideline="ICH E9"] [data-ich-missing]')).toContainText('Not in the ICH Frameworks registry')
  await expect(box.locator('[data-ich-guideline="SOP"]')).toHaveCount(0)            // not an ICH citation

  // Each guideline shows how far along its checklist items are, and lists them when clicked.
  const progress = e6.locator('[data-ich-progress]')
  await expect(progress).toHaveText('1 of 2 checklist items complete')
  await expect(e6.locator('[data-ich-items]')).toHaveCount(0)
  await progress.click()
  await expect(e6.locator('[data-ich-item]')).toHaveCount(2)
  await expect(e6.locator('[data-ich-item="complete"]')).toContainText('Item 2')
  await expect(e6.locator('[data-ich-item="pending"]')).toContainText('Item 1')
  await expect(box.locator('[data-ich-guideline="ICH E9"] [data-ich-progress]')).toHaveText('0 of 1 checklist items complete')
  await e6.locator('[data-ich-open-inputs]').click()
  await expect(page.locator('[data-checklist-tab="inputs"]')).toHaveAttribute('aria-selected', 'true')
})
