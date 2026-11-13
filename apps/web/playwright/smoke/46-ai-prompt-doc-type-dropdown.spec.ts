// QA regression — Master Library > AI Prompts: "New prompt" picks the doc type from a dropdown of every
// document type (no free typing). Doc types that already have a prompt are listed but can't be picked.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/46-ai-prompt-doc-type-dropdown.spec.ts
//
// /auth/me and the prompt list are answered inside the page; one prompt (protocol) already exists.

import { test, expect } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

test('New prompt lists every doc type; one with a prompt already is greyed out', async ({ page }) => {
  await page.addInitScript((me) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      if (path.endsWith('/auth/me')) return json(me)
      if (path.endsWith('/document-type-policies')) return json({ policies: [{ docType: 'protocol', smePrompt: 'You write protocols.', updatedAt: '2026-11-01T00:00:00.000Z' }] })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, PM)
  await page.goto('/master-library/ai-prompts')
  await page.getByRole('button', { name: '+ New' }).click({ timeout: 60_000 })
  const select = page.locator('select[data-field="create-doc-type"]')
  await expect(select).toHaveValue('')
  const options = select.locator('option')
  await expect(options).toHaveCount(11)                                   // placeholder + 10 doc types
  await expect(options.first()).toHaveText('Select a doc type')
  await expect(select.locator('option[value="csr_full"]')).toBeEnabled()
  await expect(select.locator('option[value="csr_full"]')).toHaveText('CSR (Full)')                 // the name, not the code csr_full
  await expect(select.locator('option[value="protocol"]')).toBeDisabled()
  await expect(select.locator('option[value="protocol"]')).toContainText('prompt exists')
  await select.selectOption('csr_full')
  await expect(select).toHaveValue('csr_full')
})
