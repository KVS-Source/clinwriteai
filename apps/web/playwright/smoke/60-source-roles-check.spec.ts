// New Document: each chosen source is marked as evidence (this study's facts) or an example (structure and wording
// only), and the sources are checked before Create. A file the upload check found looks like a sample starts as an
// example; a file the AI can't read isn't offered; Create stays off while the check blocks.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/60-source-roles-check.spec.ts
//
// The source library, the source check and the create call are answered inside the page; nothing is created.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
test.setTimeout(120_000)

const MEMBERS = [{ id: 'u-sarah', name: 'Sarah Chen', email: 'sarah.chen@example.com', initials: 'SC', capabilities: ['can-author'], projectRole: 'Clinical Writer' }]
const base = { fileSizeBytes: 1000, previewable: true, categorySource: 'set', origin: null, version: null, state: 'saved', virusScanStatus: 'passed', usedIn: [], uploadedBy: { id: 'u-sarah', name: 'Sarah Chen', email: null }, uploadedAt: '2026-11-20T09:00:00Z' }
const check = (over: Record<string, unknown> = {}) => ({ usable: true, problem: null, scannedPages: 0, looksLikeExample: false, exampleReason: null, study: null, duplicateOf: null, ...over })
const SOURCES = [
  { ...base, id: 'up-ours', title: 'Moon synopsis', fileName: 'synopsis.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'protocol', check: check() },
  { ...base, id: 'up-sample', title: 'Sample protocol', fileName: 'sample.pdf', contentType: 'application/pdf', category: 'protocol', check: check({ looksLikeExample: true, exampleReason: 'Has [insert drug] placeholders.' }) },
  { ...base, id: 'up-deck', title: 'Kick-off deck', fileName: 'deck.pptx', contentType: '', category: 'other', check: check({ usable: false, problem: 'PowerPoint.' }) },
]

type Log = { checks: Array<{ sources: Array<{ uploadId: string; role: string }> }>; created: Array<Record<string, unknown>> }

async function stub(page: Page) {
  await page.addInitScript(({ members, sources, persona }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const log: Log = { checks: [], created: [] }
    ;(window as unknown as { __log: Log }).__log = log
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json(members)
      if (/\/projects\/[^/]+\/source-documents(\?.*)?$/.test(url)) return json({ items: sources, total: sources.length, page: 1, pageSize: 100, summary: { files: 3, saved: 3, rejected: 0 } })
      if (/\/projects\/[^/]+\/documents\/source-check$/.test(url)) {
        const body = JSON.parse(String(init?.body)) as Log['checks'][number]
        log.checks.push(body)
        const evidence = body.sources.filter(s => s.role === 'evidence')
        return json(evidence.length === 0
          ? { ok: false, unknownIds: [], issues: [{ code: 'no_evidence', severity: 'block', message: 'Every source is marked as an example.', uploadIds: [] }] }
          : { ok: true, unknownIds: [], issues: [{ code: 'missing_ib', severity: 'warn', message: 'No Investigator’s Brochure is marked as evidence.', uploadIds: [] }] })
      }
      if (/\/projects\/[^/]+\/documents$/.test(url) && method === 'POST') {
        log.created.push(JSON.parse(String(init?.body)))
        return json({ id: 'DOC-STUB' }, 201)
      }
      if (method !== 'GET') return json({ error: 'blocked in test' }, 500)
      return real(input, init)
    }
  }, { members: MEMBERS, sources: SOURCES, persona: PM_PERSONA })
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: Log }).__log)
const next = (page: Page) => page.locator('[data-action="wizard-next"]').dispatchEvent('click')
const back = (page: Page) => page.locator('[data-action="wizard-back"]').dispatchEvent('click')
const role = (page: Page, id: string, r: string) => page.locator(`[data-source-row="${id}"] [data-source-role="${r}"]`)

test('sources are marked evidence or example, checked before Create, and sent with the document', async ({ page }) => {
  await stub(page)
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.getByRole('button', { name: /New Document/ }).first().click()
  await expect(page.locator('[data-form="new-document"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-form="new-document"] select').first().selectOption('protocol')
  await next(page)

  // A Word file is offered now; a PowerPoint the AI can't read is not.
  await page.getByRole('checkbox', { name: /Show all categories/i }).check()
  await expect(page.locator('[data-source-row="up-deck"]')).toHaveCount(0)
  await expect(page.locator('[data-banner="non-pdf-hidden"]')).toContainText('1 source is hidden')

  await page.locator('[data-source-id="up-ours"]').check()
  await page.locator('[data-source-id="up-sample"]').check()
  await expect(page.locator('[data-source-row="up-sample"] [data-looks-like-example]')).toContainText('Has [insert drug] placeholders.')
  await expect(role(page, 'up-sample', 'example')).toHaveAttribute('aria-checked', 'true')     // the upload check's suggestion
  await expect(role(page, 'up-ours', 'evidence')).toHaveAttribute('aria-checked', 'true')

  // Everything marked as an example: the check blocks Create.
  await role(page, 'up-ours', 'example').click()
  await next(page)
  await page.locator('[data-step-body="details"] input').first().fill('Moon protocol')
  await page.locator('[data-field="assignee"] input').click()
  await page.locator('[data-field="assignee"] [role="option"]').filter({ hasText: 'Sarah Chen' }).click()
  await next(page)
  await page.locator('#ai-instructions').fill('Draft the protocol for the Moon study.')
  await expect(page.locator('[data-source-check="blocked"]')).toContainText('Every source is marked as an example.')
  await expect(page.locator('button[type="submit"]')).toBeDisabled()

  // This study's synopsis back to evidence: only warnings, Create goes ahead with the roles.
  await back(page)
  await back(page)
  await role(page, 'up-ours', 'evidence').click()
  await next(page)
  await next(page)
  await expect(page.locator('[data-source-check="warnings"]')).toContainText('No Investigator’s Brochure')
  await expect(page.locator('button[type="submit"]')).toBeEnabled()
  expect((await log(page)).checks.at(-1)!.sources).toEqual([{ uploadId: 'up-ours', role: 'evidence' }, { uploadId: 'up-sample', role: 'example' }])

  await page.locator('button[type="submit"]').dispatchEvent('click')                       // the dev MSW badge covers it
  await expect.poll(async () => (await log(page)).created.length).toBe(1)
  expect((await log(page)).created[0]).toMatchObject({ sourceUploadIds: ['up-ours', 'up-sample'], sourceRoles: { 'up-ours': 'evidence', 'up-sample': 'example' } })
})
