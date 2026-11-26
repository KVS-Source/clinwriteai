// Admin → Licensing: import a policy package signed by GenBioCa. Preview shows what each document type's policy
// becomes and any warnings; Import stays off until a preview has no errors.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/61-policy-package-import.spec.ts
//
// The license, preview and import calls are answered inside the page; nothing is imported.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PREVIEW = {
  ok: true, packageId: 'protocol-build-plan', packageVersion: 1, description: 'Protocol AI build plan', issuedAt: '2026-11-26T00:00:00Z', sha256: 'a'.repeat(64),
  items: [{
    docType: 'protocol', currentVersion: 1, newVersion: 2, template: { id: 'tpl', label: 'Protocol', version: 2 },
    stages: [{ label: 'Objectives, endpoints and estimands', sections: 3 }, { label: 'Summary (last)', sections: 2 }],
    errors: [], warnings: ['The template has no title page section.'],
  }],
}

async function stub(page: Page, previewBody: unknown) {
  await page.addInitScript(({ preview }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', 'user-it')
    const log = { imports: 0 }
    ;(window as unknown as { __log: typeof log }).__log = log
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/policy-packages\/preview$/.test(url)) return json(preview)
      if (/\/policy-packages\/import$/.test(url)) { log.imports++; return json({ ...(preview as object), applied: [{ docType: 'protocol', version: 2, policyId: 'pol-2' }] }) }
      return real(input, init)
    }
  }, { preview: previewBody })
}

async function open(page: Page) {
  await page.goto('/admin')
  const tab = page.getByRole('button', { name: /^Licensing$/ }).or(page.getByRole('tab', { name: /^Licensing$/ })).or(page.getByRole('link', { name: /^Licensing$/ }))
  await tab.first().click()
  await expect(page.locator('[data-section="policy-package-import"]')).toBeVisible({ timeout: 60_000 })
}

test('preview shows the change and the warnings, then the package is imported', async ({ page }) => {
  await stub(page, PREVIEW)
  await open(page)
  const importButton = page.locator('[data-action="import-package"]')
  await expect(importButton).toBeDisabled()
  await page.locator('[data-field="policy-package"]').fill('eyJhbGciOiJSUzI1NiJ9.eyJ0eXAiOiJ4In0.c2ln')
  await page.locator('[data-action="preview-package"]').click()
  const preview = page.locator('[data-package-preview="ok"]')
  await expect(preview).toContainText('protocol: policy version 1 → 2')
  await expect(preview).toContainText('Summary (last) (2 sections)')
  await expect(preview.locator('[data-package-warning]')).toHaveText('The template has no title page section.')
  await importButton.click()
  await expect(page.locator('[data-import-done]')).toContainText('protocol policy is now version 2')
  expect(await page.evaluate(() => (window as unknown as { __log: { imports: number } }).__log.imports)).toBe(1)
})

test('a package with errors can be previewed but not imported', async ({ page }) => {
  await stub(page, { ...PREVIEW, ok: false, items: [{ ...PREVIEW.items[0], errors: ['Version 1 of this package is already imported.'] }] })
  await open(page)
  await page.locator('[data-field="policy-package"]').fill('eyJhbGciOiJSUzI1NiJ9.eyJ0eXAiOiJ4In0.c2ln')
  await page.locator('[data-action="preview-package"]').click()
  await expect(page.locator('[data-package-preview="blocked"] [data-package-error]')).toContainText('already imported')
  await expect(page.locator('[data-action="import-package"]')).toBeDisabled()
})
