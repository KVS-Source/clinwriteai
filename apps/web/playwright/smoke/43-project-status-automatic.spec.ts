// QA regression — Status history words an automatic move to Ongoing properly, in the reader's language:
// who set it off and on which document, or "System" for the one-off backfill. Manual moves keep their reason.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/43-project-status-automatic.spec.ts
//
// Everything is answered inside the page. What triggers the move is covered by the API tests.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'P-1'

async function open(page: Page, language = 'en') {
  await page.addInitScript(({ language, PROJECT }) => {
    localStorage.setItem('clinwrite.uiLanguage', language)
    localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const me = { id: 'user-sa', email: 'pm@x.test', name: 'Pat Manager', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const project = { id: PROJECT, name: 'Project One', shortTitle: 'Project One', status: 'ongoing', phase: 'Phase 1', therapeuticArea: 'Oncology', tenantId: null, activeModules: ['A'], submissionCountries: ['US'], team: [], documentCount: 0, startDate: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' }
    const status = {
      status: 'ongoing',
      next: ['on-hold', 'closed'],
      history: [
        { id: 'a-3', at: '2026-11-06T10:00:00Z', by: 'Pat Manager', from: 'on-hold', to: 'ongoing', reason: 'Sponsor is back', automatic: null, document: null },
        { id: 'a-2', at: '2026-11-05T10:00:00Z', by: 'Sam Author', from: 'initiated', to: 'ongoing', reason: 'raw audit text', automatic: 'authoring_started', document: 'CSR draft' },
        { id: 'a-1', at: '2026-11-04T10:00:00Z', by: 'system:backfill-project-ongoing', from: 'initiated', to: 'ongoing', reason: 'raw audit text', automatic: 'work_already_started', document: 'Protocol' },
      ],
    }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.href).pathname
      if (path.startsWith('/src/') || path.startsWith('/node_modules/') || path.startsWith('/@')) return real(input, init)
      if (/\/auth\/me$/.test(path)) return json(me)
      if (path.endsWith(`/projects/${PROJECT}/status`)) return json(status)
      if (path.endsWith(`/projects/${PROJECT}`)) return json(project)
      if (path.endsWith('/projects')) return json([project])
      return json([])
    }
  }, { language, PROJECT })
  await page.goto(`/projects/${PROJECT}/settings`, { waitUntil: 'domcontentloaded' })
}

const entry = (page: Page, id: string) => page.locator(`[data-status-history-entry="${id}"]`)

test('an automatic move says what set it off and who; a manual one keeps its reason', async ({ page }) => {
  await open(page)
  await expect(entry(page, 'a-2')).toContainText('Automatically moved to Ongoing: authoring started on CSR draft', { timeout: 60_000 })
  await expect(entry(page, 'a-2')).toContainText('Sam Author')
  await expect(entry(page, 'a-3')).toContainText('Sponsor is back')
  await expect(page.locator('[data-status-history]')).not.toContainText('raw audit text')
})

test('the backfill shows as the System, not its internal actor id', async ({ page }) => {
  await open(page)
  await expect(entry(page, 'a-1')).toContainText('work had already started on Protocol', { timeout: 60_000 })
  await expect(entry(page, 'a-1')).toContainText('System')
  await expect(entry(page, 'a-1')).not.toContainText('backfill')
})

test('in Japanese it is Japanese', async ({ page }) => {
  await open(page, 'ja')
  await expect(entry(page, 'a-2')).toContainText('自動的に進行中へ移行しました', { timeout: 60_000 })
  await expect(entry(page, 'a-1')).toContainText('システム')
})
