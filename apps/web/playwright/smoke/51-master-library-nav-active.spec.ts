// QA regression — the Master Library sidebar entry is highlighted on every Master Library tab, the same way
// TA Tags is on its page. /master-library always redirects to a tab, so an exact-path match never lit it.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/51-master-library-nav-active.spec.ts
//
// Everything is answered inside the page; nothing reaches the API.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM = { id: 'u-pm', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }

async function open(page: Page, path: string) {
  await page.addInitScript((me) => {
    localStorage.setItem('clinwrite.uiLanguage', 'en')
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
  await page.goto(path)
}

const link = (page: Page, href: string) => page.locator(`[data-platform-link="${href}"]`)

for (const tab of ['documents', 'best-practices', 'ich-frameworks']) {
  test(`Master Library is highlighted on /master-library/${tab}`, async ({ page }) => {
    await open(page, `/master-library/${tab}`)
    await expect(link(page, '/master-library')).toHaveAttribute('aria-current', 'page', { timeout: 60_000 })
    await expect(link(page, '/master-library')).toHaveClass(/text-white/)
    await expect(link(page, '/admin/taxonomy')).not.toHaveAttribute('aria-current', 'page')
  })
}

test('clicking Master Library in the sidebar lands on a tab with the entry highlighted', async ({ page }) => {
  await open(page, '/admin/taxonomy')
  await expect(link(page, '/admin/taxonomy')).toHaveAttribute('aria-current', 'page', { timeout: 60_000 })
  await link(page, '/master-library').click()
  await expect(page).toHaveURL(/\/master-library\/documents/)
  await expect(link(page, '/master-library')).toHaveAttribute('aria-current', 'page')
  await expect(link(page, '/admin/taxonomy')).not.toHaveAttribute('aria-current', 'page')
})
