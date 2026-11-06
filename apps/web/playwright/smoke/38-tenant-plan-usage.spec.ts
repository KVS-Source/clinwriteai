// QA regression — Services, Subscription, Reports, Admin > Subscription and Super Admin > Analytics show the signed-in
// tenant's real plan and AI usage. What nothing records yet (allowance, fee, card, invoices, savings, revenue) shows as
// not recorded, never as a made-up figure: no "client-default", "growth", "50M tokens", Visa 4242 or fixed client name.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/38-tenant-plan-usage.spec.ts
//
// /auth/me and the plan / usage calls are answered inside the page with the API's response shape; nothing is written.
// The server's own rules are in apps/api (subscriptions/tenant-view.test.ts). Any other API call that comes back 401
// is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const view = (over: Record<string, unknown> = {}) => ({
  clientId: 'T-A', clientName: 'Acme Oncology', scope: 'tenant', hasSubscription: false, planName: null, monthlyCapUsd: null,
  renewalDate: null, contractedTokensPerMonth: null, monthlyFee: null, paymentMethod: null, autoRenew: false, currency: 'USD', activeGateways: [],
  currentPeriod: { month: '2026-11', tokensConsumed: 2514, tokensRemaining: null, estimatedSpend: 0.03, burnRatePerDay: 0.01, projectedEndOfMonth: 0.16 },
  moduleBreakdown: [{ module: 'A', label: 'Clinical Writing', tokensConsumed: 2514, cost: 0.03, pctOfTotal: 100, burnRate: null, status: null }],
  invoices: [], marketValueSavings: null, ...over,
})
const WITH_PLAN = view({ hasSubscription: true, planName: 'starter', monthlyCapUsd: 200, renewalDate: '2026-12-01' })
const PLATFORM = view({ clientId: 'platform', clientName: null, scope: 'platform' })

const ANALYTICS = {
  totalActiveUsers: 27, activeProjects: 23, documentsCreatedRolling30: 12, aiTokensRolling30: 157147, aiTokensUnattributedRolling30: 79221,
  mrrGBP: null, arrGBP: null, activeSubscriptions: 0, churnThisQuarter: 1, avgTokensPerClientMonth: 15585,
  clientCounts: { active: 5, suspended: 1, churned: 1 },
}
const CONFIG = {
  clientId: 'T-A', clientName: 'Acme Oncology', plan: null, planStartDate: null, renewalDate: null, contractedTokensPerMonth: null, currency: 'USD',
  aiEngine: { default: 'anthropic', fallback: 'none', perModuleOverrideEnabled: false, availableEngines: [], lastTested: null, lastTestedLatencyMs: null },
  seats: { used: 9, total: 9 }, paymentGateways: [], externalApis: [], featureFlags: [], integrations: [],
}

async function open(page: Page, path: string, sub: unknown, tenantId: string | null = 'T-A') {
  await page.addInitScript(({ sub, tenantId, analytics, config }) => {
    const me = { id: 'u-a', email: 'a@x.io', name: 'Ada Admin', role: 'tenant-admin', modules: ['A'], status: 'active', lastActiveAt: null, tenantId }
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/auth\/me(\?.*)?$/.test(url)) return json(me)
      if (/\/(services\/dashboard|admin\/subscription)(\?.*)?$/.test(url)) return json(sub)
      if (/\/super-admin\/analytics(\?.*)?$/.test(url)) return json(analytics)
      if (/\/super-admin\/clients(\?.*)?$/.test(url)) return json([{ id: 'T-A', name: 'Acme Oncology', plan: null, status: 'active', adminContactName: null, createdAt: '2026-01-01T00:00:00Z', revenueToDateGBP: null }])
      if (/\/admin\/config(\?.*)?$/.test(url)) return json(config)
      if (/\/ai\/usage-analytics/.test(url)) return json({ windowDays: 30, totals: { calls: 0, tokens: 0, costUsd: 0 }, dailyTokens: [], promptIntents: [], modelMix: [], topPrompts: [], topUsers: [], hourlyDistribution: [], hourlyPeakLabel: '' })
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { sub, tenantId, analytics: ANALYTICS, config: CONFIG })
  await page.goto(path, { waitUntil: 'domcontentloaded' })
}

const FAKE = /client-default|GenBioCa Sciences|4242|Visa|50,000,000|13,200,000|12,430/

test.describe('Services', () => {
  test('a tenant with no plan: its name, its real usage, a notice, and nothing made up', async ({ page }) => {
    await open(page, '/services', view())
    const screen = page.locator('[data-screen="services-dashboard"]')
    await expect(page.locator('[data-header-blurb]')).toContainText('Acme Oncology', { timeout: 60_000 })
    await expect(page.locator('[data-no-plan-notice="tenant"]')).toContainText('Acme Oncology has no active subscription')
    await expect(page.locator('[data-stat="tokens-consumed"]')).toContainText('2,514')
    await expect(page.locator('[data-stat="estimated-spend"]')).toContainText('$0.03')
    await expect(page.locator('[data-stat="remaining-balance"]')).toContainText('—')
    await expect(page.locator('[data-stat="contracted"]')).toContainText('Not recorded')
    await expect(page.locator('[data-stat="renewal"]')).toContainText('Not recorded')
    await expect(page.locator('[data-breakdown-row="A"]')).toContainText('Clinical Writing')
    await expect(page.locator('[data-top-up]')).toBeDisabled()
    expect(await screen.innerText()).not.toMatch(FAKE)
  })

  test('a tenant with a plan: its AI cap and renewal, no notice, and top-up is available', async ({ page }) => {
    await open(page, '/services', WITH_PLAN)
    await expect(page.locator('[data-stat="contracted"]')).toContainText('$200', { timeout: 60_000 })
    await expect(page.locator('[data-stat="renewal"]')).toContainText('01 Dec 2026')
    await expect(page.locator('[data-no-plan-notice]')).toHaveCount(0)
    await expect(page.locator('[data-top-up]')).toBeEnabled()
  })

  test('a platform admin is told this is all tenants', async ({ page }) => {
    await open(page, '/services', PLATFORM, null)
    await expect(page.locator('[data-no-plan-notice="platform"]')).toContainText('across all tenants', { timeout: 60_000 })
    await expect(page.locator('[data-header-blurb]')).toContainText('all tenants')
  })
})

test.describe('Subscription', () => {
  test('no plan: says so, with no fake invoice or card, and top-up is refused', async ({ page }) => {
    await open(page, '/admin/subscription', view())
    await expect(page.locator('[data-no-plan]')).toHaveText('No active plan', { timeout: 60_000 })
    await expect(page.locator('[data-scope-used]')).toHaveText('2,514')
    await expect(page.locator('[data-scope-included]')).toHaveText('—')
    await expect(page.locator('[data-next-invoice]')).toHaveCount(0) // hidden until a payment gateway exists
    await expect(page.locator('[data-no-invoices]')).toBeVisible()
    await expect(page.locator('[data-update-payment]')).toHaveCount(0)
    await expect(page.locator('[data-proceed-payment]')).toBeDisabled()
    await expect(page.locator('[data-topup-needs-plan]')).toBeVisible()
    expect(await page.locator('[data-screen="subscription-payment"]').innerText()).not.toMatch(FAKE)
  })

  test('with a plan: the plan name and renewal, under the tenant’s own name', async ({ page }) => {
    await open(page, '/admin/subscription', WITH_PLAN)
    await expect(page.locator('[data-plan-name]')).toContainText('starter', { timeout: 60_000 })
    await expect(page.locator('[data-plan-name]')).toContainText('Acme Oncology · renews 01 Dec 2026')
    await expect(page.locator('[data-proceed-payment]')).toBeEnabled()
  })
})

test('Reports: savings aren’t calculated yet, and the page still renders', async ({ page }) => {
  await open(page, '/reports', view())
  await expect(page.locator('[data-tokens]')).toHaveText('2,514', { timeout: 60_000 })
  await expect(page.locator('[data-saving]')).toHaveText('—')
  await expect(page.locator('[data-effective-multiple]')).toHaveText('—')
  await expect(page.locator('[data-savings-not-calculated]')).toBeVisible()
})

test('Admin > Subscription: no made-up plan or token allowance', async ({ page }) => {
  await open(page, '/admin', view())
  await page.getByRole('button', { name: 'Subscription', exact: true }).or(page.getByRole('tab', { name: 'Subscription', exact: true })).first().click({ timeout: 60_000 })
  const panel = page.locator('[data-tab-panel="subscription"]')
  await expect(panel.locator('[data-plan-value]')).toHaveText('—')
  await expect(panel).toContainText('No token allowance or renewal date is recorded')
  await expect(panel).not.toContainText('Professional')
  await expect(panel.locator('[data-tokens-value]')).toHaveText('3K')       // real usage (2,514), not spend shown as tokens
})

test('Super Admin > Analytics: real AI tokens, and revenue shown as unknown rather than £0', async ({ page }) => {
  await open(page, '/super-admin', view(), null)
  await page.locator('[data-settings-tab="analytics"]').click({ timeout: 60_000 })
  await expect(page.locator('[data-stat="aiTokens"]')).not.toHaveText('0')
  await expect(page.locator('[data-unattributed-tokens]')).toContainText('not linked to a client')
  await expect(page.locator('[data-revenue="mrr"]')).toHaveText('—')
  await expect(page.locator('[data-revenue="arr"]')).toHaveText('—')
  await expect(page.locator('[data-revenue-note]')).toContainText('Billing not connected · 0 active subscriptions')
  await expect(page.locator('[data-revenue="churn"]')).toContainText('1')
})
