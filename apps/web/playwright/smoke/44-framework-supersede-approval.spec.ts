// QA regression — Master Library > ICH Frameworks: marking a framework superseded needs a second person.
//   - A Project Manager picks "Superseded" and clicks "Send for approval →" (no direct "Mark as superseded").
//   - While pending, the framework shows "Pending approval". The requester waits; another PM or a QC sees
//     Approve / Reject; Reject needs a reason. Anyone else is told a PM or QC decides.
//   - Approving supersedes the framework; rejecting keeps it current and shows the reason.
//   - A notification link (?open=<id>) opens the framework's panel.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/44-framework-supersede-approval.spec.ts
//
// /auth/me, the framework list and the supersede-request endpoints are answered inside the page (stateful, so
// a send / approve / reject shows up on refetch); calls are recorded on window.__calls. The server's rules
// (PM sends, other PM or QC decides, notifications, audit) are in apps/api frameworks/routes.test.ts.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PM_A = { id: 'u-pm-a', email: 'pat@example.com', name: 'Pat PM', role: 'pm', modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
const PM_B = { ...PM_A, id: 'u-pm-b', email: 'paula@example.com', name: 'Paula PM' }
const QC   = { ...PM_A, id: 'u-qc', email: 'quinn@example.com', name: 'Quinn QC', role: 'qc' }
const CON  = { ...PM_A, id: 'u-con', email: 'cora@example.com', name: 'Cora', role: 'contributor' }

type Call = { method: string; path: string; body: unknown }

async function open(page: Page, me: Record<string, unknown>, opts: { pendingBy?: string; rejected?: boolean } = {}, path = '/master-library/ich-frameworks') {
  await page.addInitScript(({ me, opts }) => {
    const w = window as unknown as { __calls: Call[] }
    w.__calls = []
    const frameworks = [
      { id: 'fw-1', name: 'ICC 45', description: 'ICC 45', jurisdiction: 'ICH', version: 'r1', effectiveDate: '2020-01-01', retiredAt: null as string | null, updatedAt: '2026-10-15' },
      { id: 'fw-2', name: 'ICH E3', description: 'ICH E3', jurisdiction: 'ICH', version: 'r1', effectiveDate: '2020-01-01', retiredAt: null as string | null, updatedAt: '2026-10-15' },
    ]
    type R = { id: string; frameworkId: string; status: string; reason: string | null; requestedBy: string; requestedByName: string; requestedAt: string; decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; rejectionReason: string | null }
    const requests: R[] = []
    if (opts.pendingBy) requests.push({ id: 'req-1', frameworkId: 'fw-1', status: 'pending', reason: 'Replaced by ICC 46', requestedBy: opts.pendingBy, requestedByName: opts.pendingBy === 'u-pm-a' ? 'Pat PM' : 'Paula PM', requestedAt: '2026-11-12T09:00:00.000Z', decidedBy: null, decidedByName: null, decidedAt: null, rejectionReason: null })
    if (opts.rejected) requests.push({ id: 'req-0', frameworkId: 'fw-1', status: 'rejected', reason: null, requestedBy: 'u-pm-a', requestedByName: 'Pat PM', requestedAt: '2026-11-10T09:00:00.000Z', decidedBy: 'u-qc', decidedByName: 'Quinn QC', decidedAt: '2026-11-11T09:00:00.000Z', rejectionReason: 'ICC 46 not effective yet' })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const u = new URL(url, location.origin)
      const m = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (u.pathname.endsWith('/auth/me')) return json(me)
      if (u.pathname.endsWith('/admin/frameworks')) return json(frameworks)
      if (u.pathname.endsWith('/admin/frameworks/supersede-requests') && m === 'GET') {
        const st = u.searchParams.get('status'); const fid = u.searchParams.get('frameworkId')
        return json(requests.filter(r => (!st || r.status === st) && (!fid || r.frameworkId === fid)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)))
      }
      const send = u.pathname.match(/\/admin\/frameworks\/([^/]+)\/supersede-request$/)
      if (send && m === 'POST') {
        w.__calls.push({ method: m, path: `/admin/frameworks/${send[1]}/supersede-request`, body })
        const r = { id: 'req-new', frameworkId: send[1]!, status: 'pending', reason: body?.reason ?? null, requestedBy: (me as { id: string }).id, requestedByName: (me as { name: string }).name, requestedAt: new Date().toISOString(), decidedBy: null, decidedByName: null, decidedAt: null, rejectionReason: null }
        requests.push(r)
        return json(r, 201)
      }
      const dec = u.pathname.match(/\/supersede-requests\/([^/]+)\/(approve|reject)$/)
      if (dec && m === 'POST') {
        w.__calls.push({ method: m, path: `/supersede-requests/${dec[1]}/${dec[2]}`, body })
        const r = requests.find(x => x.id === dec[1])!
        r.status = dec[2] === 'approve' ? 'approved' : 'rejected'
        r.decidedBy = (me as { id: string }).id; r.decidedByName = (me as { name: string }).name; r.decidedAt = new Date().toISOString()
        if (dec[2] === 'reject') r.rejectionReason = body.reason
        else frameworks.find(f => f.id === r.frameworkId)!.retiredAt = new Date().toISOString()
        return json(r)
      }
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { me, opts })
  await page.goto(path)
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
const openFw1 = async (page: Page) => {
  await page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICC 45' }).click({ timeout: 60_000 })
  await expect(page.locator('[data-edit-drawer]')).toBeVisible()
}

test('a PM sends a framework for approval (no direct "Mark as superseded")', async ({ page }) => {
  await open(page, PM_A)
  await openFw1(page)
  await page.locator('[data-status-select]').selectOption('Deprecated')
  await expect(page.locator('[data-save-framework]')).toHaveText('Send for approval →')
  await expect(page.getByRole('button', { name: /^Mark as superseded/ })).toHaveCount(0)
  await page.locator('[data-request-reason]').fill('Replaced by ICC 46')
  await page.locator('[data-save-framework]').click()
  await expect(page.locator('[data-confirm-dialog]')).toContainText('Send ICC 45 for approval?')
  await expect(page.locator('[data-confirm-dialog]')).toContainText('Every Project Manager and QC is notified')
  await page.locator('[data-action="confirm-ok"]').click()
  await expect(page.locator('[data-save-result]')).toContainText('ICC 45 sent for approval')
  expect(await calls(page)).toContainEqual({ method: 'POST', path: '/admin/frameworks/fw-1/supersede-request', body: { reason: 'Replaced by ICC 46' } })
  // Now pending, and the requester can't decide it.
  await expect(page.locator('[data-active-pending-chip]')).toHaveText('Pending approval')
  await expect(page.locator('[data-pending-own]')).toBeVisible()
  await expect(page.locator('[data-action="approve-request"]')).toHaveCount(0)
  await expect(page.locator('[data-frameworks-table] tbody tr', { hasText: 'ICC 45' }).locator('[data-pending-chip]')).toBeVisible()
})

for (const [who, me] of [['another PM', PM_B], ['a QC', QC]] as const) {
  test(`${who} approves: the framework becomes superseded`, async ({ page }) => {
    await open(page, me, { pendingBy: 'u-pm-a' })
    await openFw1(page)
    await expect(page.locator('[data-pending-requested-by]')).toContainText('Sent by Pat PM')
    await expect(page.locator('[data-pending-reason]')).toContainText('Replaced by ICC 46')
    await page.locator('[data-action="approve-request"]').click()
    await expect(page.locator('[data-confirm-dialog]')).toContainText('Approve and mark ICC 45 as superseded?')
    await page.locator('[data-action="confirm-ok"]').click()
    await expect(page.locator('[data-save-result]')).toContainText('ICC 45 is now superseded')
    expect((await calls(page)).map(c => c.path)).toContain('/supersede-requests/req-1/approve')
    await expect(page.locator('[data-superseded-note]')).toBeVisible()
  })
}

test('rejecting needs a reason; the framework stays current and the reason is shown', async ({ page }) => {
  await open(page, QC, { pendingBy: 'u-pm-a' })
  await openFw1(page)
  await page.locator('[data-action="reject-request"]').click()
  const confirm = page.locator('[data-action="confirm-reject"]')
  await expect(confirm).toBeDisabled()
  await page.locator('[data-reject-reason]').fill('ICC 46 not effective yet')
  await confirm.click()
  await expect(page.locator('[data-save-result]')).toContainText('Request rejected. ICC 45 stays current')
  expect(await calls(page)).toContainEqual({ method: 'POST', path: '/supersede-requests/req-1/reject', body: { reason: 'ICC 46 not effective yet' } })
  await expect(page.locator('[data-active-pending-chip]')).toHaveCount(0)
  await expect(page.locator('[data-last-rejection]')).toContainText('rejected by Quinn QC')
  await expect(page.locator('[data-last-rejection]')).toContainText('ICC 46 not effective yet')
})

test('a Contributor sees the pending request but cannot approve or reject', async ({ page }) => {
  await open(page, CON, { pendingBy: 'u-pm-a' })
  await openFw1(page)
  await expect(page.locator('[data-pending-readonly]')).toHaveText('A Project Manager or a QC decides.')
  await expect(page.locator('[data-action="approve-request"], [data-action="reject-request"]')).toHaveCount(0)
})

test('a QC cannot send for approval (only a PM can)', async ({ page }) => {
  await open(page, QC)
  await openFw1(page)
  await expect(page.locator('[data-status-pm-only]')).toContainText('Only a Project Manager can send a framework for approval')
  await expect(page.locator('[data-save-framework]')).toHaveCount(0)
})

test('the PM sees why their last request was rejected, and can send again', async ({ page }) => {
  await open(page, PM_A, { rejected: true })
  await openFw1(page)
  await expect(page.locator('[data-last-rejection]')).toContainText('ICC 46 not effective yet')
  await expect(page.locator('[data-status-select]')).toBeVisible()
})

test('a notification link opens the framework panel', async ({ page }) => {
  await open(page, PM_B, { pendingBy: 'u-pm-a' }, '/master-library/ich-frameworks?open=fw-1')
  await expect(page.locator('[data-edit-drawer][data-active-framework="fw-1"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-action="approve-request"]')).toBeVisible()
})

test('the registry note says who does what', async ({ page }) => {
  await open(page, PM_A)
  await expect(page.locator('[data-access-note]')).toContainText('A Project Manager sends a framework for approval', { timeout: 60_000 })
  await expect(page.getByText('Only Super Admin can add a framework or change a status')).toHaveCount(0)
})
