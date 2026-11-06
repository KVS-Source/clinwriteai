// QA regression — Subscription: no card or next invoice until a gateway exists, one number format, and an
// empty invoice history that says so.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/41-subscription-page.spec.ts
//
// Everything is answered inside the page, so no top-up request is recorded.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)
// The browser setting that used to produce Indian digit grouping.
test.use({ locale: 'en-IN' })

type Stub = { gateway?: boolean; card?: boolean; invoices?: boolean; language?: string }

async function open(page: Page, stub: Stub = {}) {
  await page.addInitScript((stub) => {
    localStorage.setItem('clinwrite.uiLanguage', stub.language ?? 'en')
    localStorage.setItem('clinwrite.demo.currentUserId', 'user-admin')
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const me = { id: 'user-admin', email: 'a@x.test', name: 'Ada Admin', role: 'tenant-admin', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 'T-1' }
    const sub = {
      clientId: 'c', planName: 'growth', contractedTokensPerMonth: 50_000_000, currency: 'USD', monthlyFee: 50000, renewalDate: '2099-01-15', autoRenew: true,
      paymentMethod: stub.card ? { type: 'card', brand: 'Mastercard', last4: '1111', expiryMonth: 1, expiryYear: 2099 } : null,
      activeGateways: [],
      currentPeriod: { month: '2026-11', tokensConsumed: 13_200_000, tokensRemaining: 36_800_000, estimatedSpend: 12430, burnRatePerDay: 420, projectedEndOfMonth: 24000 },
      moduleBreakdown: [], marketValueSavings: { total: 0, calculatedAt: '2026-11-01T00:00:00Z', rateCardVersion: 'v1', rateCardSetBy: 'platform', rateCardEffectiveDate: '2026-11-01', breakdown: [] },
      invoices: stub.invoices ? [{ id: 'INV-1', date: '2026-10-01', services: 'Tokens', amount: 1234567, status: 'paid', pdfUrl: '#' }] : [],
    }
    const cfg = { paymentGateways: [{ id: 'stripe', label: 'Stripe', status: stub.gateway ? 'active' : 'inactive', lastTested: null }] }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (url.includes('/services/dashboard') || url.includes('/admin/subscription')) return json(sub)
      if (url.includes('/config')) return json(cfg)
      const path = new URL(url, location.href).pathname
      if (!path.startsWith('/src/') && !path.startsWith('/node_modules/') && !path.startsWith('/@')) return json([], 200)
      return real(input, init)
    }
  }, stub)
  await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-current-plan]')).toBeVisible({ timeout: 60_000 })
}

test.describe('with no payment gateway connected', () => {
  test('there is no card or next invoice', async ({ page }) => {
    await open(page)
    await expect(page.locator('[data-no-gateway]')).toBeVisible()
    await expect(page.locator('[data-next-invoice]')).toHaveCount(0)
    await expect(page.locator('[data-screen="subscription-payment"]')).not.toContainText('Auto-charge')
    await expect(page.locator('[data-update-payment]')).toHaveCount(0)
  })

  test('a leftover card on the record is still not shown', async ({ page }) => {
    await open(page, { card: true })
    await expect(page.locator('[data-no-gateway]')).toBeVisible()
    await expect(page.locator('[data-next-invoice]')).toHaveCount(0)
  })

  test('the top-up panel does not promise payment or instant tokens', async ({ page }) => {
    await open(page)
    await expect(page.locator('[data-proceed-payment]')).toHaveText('Submit top-up request')
    await expect(page.locator('[data-topup-panel]')).not.toContainText('added immediately')
    await expect(page.locator('[data-no-card-storage-note]')).toHaveCount(0)
  })
})

test.describe('with a gateway connected', () => {
  test('and a payment method, the next invoice shows', async ({ page }) => {
    await open(page, { gateway: true, card: true })
    await expect(page.locator('[data-next-invoice]')).toContainText('Mastercard')
    await expect(page.locator('[data-next-invoice]')).toContainText('$50,000')
    await expect(page.locator('[data-proceed-payment]')).toContainText('Proceed to payment')
    await expect(page.locator('[data-no-card-storage-note]')).toBeVisible()
  })

  test('but no payment method, it stays hidden', async ({ page }) => {
    await open(page, { gateway: true })
    await expect(page.locator('[data-next-invoice]')).toHaveCount(0)
  })
})

test('numbers use one format, even on a browser set to India', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-scope-included]')).toHaveText('50,000,000')
  await expect(page.locator('[data-scope-used]')).toHaveText('13,200,000')
  await expect(page.locator('[data-scope-remaining]')).toHaveText('36,800,000')
})

test('an empty invoice history says so', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-invoices-empty]')).toHaveText('No invoices yet.')
})

test('with invoices, the rows show and the empty message does not', async ({ page }) => {
  await open(page, { invoices: true })
  await expect(page.locator('[data-invoice-row="INV-1"]')).toContainText('$1,234,567')
  await expect(page.locator('[data-invoices-empty]')).toHaveCount(0)
})

test('the empty message and button are Japanese in Japanese', async ({ page }) => {
  await open(page, { language: 'ja' })
  await expect(page.locator('[data-invoices-empty]')).toHaveText('請求書はまだありません。')
  await expect(page.locator('[data-proceed-payment]')).toHaveText('トップアップをリクエスト')
})
