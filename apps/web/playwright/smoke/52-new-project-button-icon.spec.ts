// QA regression — the plus on "+ New Project" is centred on the label, not sitting low.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/52-new-project-button-icon.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'user-sa', email: 'pm@x.test', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

test('the plus and the label share the same vertical centre', async ({ page }) => {
  await page.addInitScript((me) => {
    localStorage.setItem('clinwrite.uiLanguage', 'en')
    localStorage.setItem('clinwrite.demo.currentUserId', 'user-sa')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const p = new URL(url, location.origin).pathname
      if (p.startsWith('/src/') || p.startsWith('/node_modules/') || p.startsWith('/@')) return real(input, init)
      if (p.endsWith('/auth/me')) return json(me)
      return json([])
    }
  }, PM)
  await page.goto('/projects')
  const button = page.locator('[data-action="new-project"]')
  await expect(button).toBeVisible({ timeout: 60_000 })

  const icon = (await button.locator('[data-new-project-icon]').boundingBox())!
  const box = (await button.boundingBox())!
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2
  expect(Math.abs(centre(icon) - centre(box))).toBeLessThanOrEqual(1)
  await expect(button).toHaveText('New Project')
})
