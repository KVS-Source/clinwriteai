// New Document with the policy's AI cost estimate on: step 4 shows the estimated range in the install's currency and
// takes an optional cost limit, which goes with the create call. With the estimate off nothing is shown.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/62-cost-estimate.spec.ts
//
// The policy, estimate, source check and create calls are answered inside the page; nothing is created.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
test.setTimeout(120_000)

const MEMBERS = [{ id: 'u-sarah', name: 'Sarah Chen', email: 'sarah.chen@example.com', initials: 'SC', capabilities: ['can-author'], projectRole: 'Clinical Writer' }]
const SOURCE = { id: 'up-1', title: 'Moon synopsis', fileName: 'synopsis.pdf', fileSizeBytes: 1000, contentType: 'application/pdf', previewable: true, category: 'protocol', categorySource: 'set', origin: null, version: null, state: 'saved', virusScanStatus: 'passed', usedIn: [], uploadedBy: { id: 'u-sarah', name: 'Sarah Chen', email: null }, uploadedAt: '2026-11-20T09:00:00Z', check: null }
const ESTIMATE = {
  enabled: true, available: true, currency: 'INR', rateMissing: false, low: 420.5, high: 1260, lowUsd: 5, highUsd: 15,
  minutesLow: 13, minutesHigh: 40, model: 'claude-sonnet-4-6', rateCardVersion: 'v1',
  basis: { sections: 50, sourceTokens: 400000, perSectionSourceTokens: 22857, cached: false, validationPasses: [1, 3] },
}

async function stub(page: Page, costEstimateEnabled: boolean) {
  await page.addInitScript(({ members, source, estimate, enabled }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const log = { created: [] as unknown[], estimates: 0 }
    ;(window as unknown as { __log: typeof log }).__log = log
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) return json(members)
      if (/\/projects\/[^/]+\/source-documents(\?.*)?$/.test(url)) return json({ items: [source], total: 1, page: 1, pageSize: 100, summary: { files: 1, saved: 1, rejected: 0 } })
      if (/\/document-type-policies\/protocol$/.test(url)) {
        return json({ id: 'pol', docType: 'protocol', version: 3, isCurrent: true, smePrompt: 'SME prompt', bestPracticeDigest: { principles: [] }, sectionRules: {}, templateId: null, checklistTemplateId: null, ichFramework: null, ichFrameworkNames: [], requirements: { requireSources: true, requireTemplate: false, requirePurpose: false }, costEstimateEnabled: enabled })
      }
      if (/\/projects\/[^/]+\/documents\/cost-estimate$/.test(url)) { log.estimates++; return json(estimate) }
      if (/\/projects\/[^/]+\/documents\/source-check$/.test(url)) return json({ ok: true, unknownIds: [], issues: [] })
      if (/\/projects\/[^/]+\/documents$/.test(url) && method === 'POST') { log.created.push(JSON.parse(String(init?.body))); return json({ id: 'DOC-STUB' }, 201) }
      if (method !== 'GET') return json({ error: 'blocked in test' }, 500)
      return real(input, init)
    }
  }, { members: MEMBERS, source: SOURCE, estimate: ESTIMATE, enabled: costEstimateEnabled })
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: { created: Array<Record<string, unknown>>; estimates: number } }).__log)
const next = (page: Page) => page.locator('[data-action="wizard-next"]').dispatchEvent('click')

async function toStep4(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.getByRole('button', { name: /New Document/ }).first().click()
  await expect(page.locator('[data-form="new-document"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-form="new-document"] select').first().selectOption('protocol')
  await next(page)
  await page.getByRole('checkbox', { name: /Show all categories/i }).check()
  await page.locator('[data-source-id="up-1"]').check()
  await next(page)
  await page.locator('[data-step-body="details"] input').first().fill('Moon protocol')
  await page.locator('[data-field="assignee"] input').click()
  await page.locator('[data-field="assignee"] [role="option"]').filter({ hasText: 'Sarah Chen' }).click()
  await next(page)
}

test('with the estimate on: the range in rupees, and the limit goes with Create', async ({ page }) => {
  await stub(page, true)
  await toStep4(page)
  await expect(page.locator('[data-cost-estimate-range]')).toHaveText(/420\.50 INR – 1,260\.00 INR/)
  await expect(page.locator('[data-cost-estimate]')).toContainText('50 sections drafted by the AI, about 13–40 minutes')
  const limit = page.locator('[data-field="cost-limit"] input')
  await expect(limit).toHaveAttribute('placeholder', '1260')
  await limit.fill('-5')
  await expect(page.locator('button[type="submit"]')).toBeDisabled()
  await limit.fill('1500')
  await expect(page.locator('button[type="submit"]')).toBeEnabled()
  await page.locator('button[type="submit"]').dispatchEvent('click')
  await expect.poll(async () => (await log(page)).created.length).toBe(1)
  expect((await log(page)).created[0]).toMatchObject({ aiCostLimit: { amount: 1500 } })
})

test('with the estimate off (the default) nothing is shown or sent', async ({ page }) => {
  await stub(page, false)
  await toStep4(page)
  await expect(page.locator('[data-step-body="ai-drafting"]')).toBeVisible()
  await expect(page.locator('[data-cost-estimate]')).toHaveCount(0)
  await page.locator('button[type="submit"]').dispatchEvent('click')
  await expect.poll(async () => (await log(page)).created.length).toBe(1)
  expect((await log(page)).created[0]).not.toHaveProperty('aiCostLimit')
  expect((await log(page)).estimates).toBe(0)
})
