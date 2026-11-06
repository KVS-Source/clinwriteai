// QA regression — Onboarding wizard (/onboarding/:module), step 2 "Your role" (FR-PM-019 / AC-PM-015): it shows
// the signed-in user's RACI for the module, from GET /projects/:id/raci where the project has saved assignments
// and the role template otherwise. It never calls the old /raci/proj-velora-301 route (404 on the API) and never
// swaps the signed-in user for a demo persona.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/37-onboarding-raci.spec.ts
//
// /auth/me, /projects and /projects/:id/raci are answered inside the page and recorded; nothing is written. Any
// other API call that comes back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

type Opts = { role?: string; projects?: string[]; raciStatus?: number; projectsStatus?: number }
const override = (activity: string, over: Record<string, unknown>) => ({
  id: activity, projectId: 'x', activity, responsibleId: null, accountableId: null, consultedIds: [], informedIds: [],
  notes: null, updatedBy: 'u-pm', updatedAt: '2026-11-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', ...over,
})
// P1: Mia is consulted on one task, and someone else now owns a task the template gives her role.
// P2: nothing customised.
const RACI: Record<string, unknown[]> = {
  P1: [override('A:a-t2', { consultedIds: ['u-me'] }), override('A:a-t1', { responsibleId: 'u-other' })],
  P2: [],
}

async function open(page: Page, opts: Opts = {}) {
  await page.addInitScript(({ role, projects, raci, raciStatus, projectsStatus }) => {
    const me = { id: 'u-me', email: 'mia@example.com', name: 'Mia Member', role, modules: ['A'], status: 'active', lastActiveAt: null, tenantId: null }
    const w = window as unknown as { __urls: string[]; __raciStatus: number }
    w.__urls = []
    w.__raciStatus = raciStatus
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      w.__urls.push(new URL(url, window.location.href).pathname)
      if (/\/auth\/me(\?.*)?$/.test(url) && method === 'GET') return json(me)
      if (/\/projects(\?.*)?$/.test(url) && method === 'GET') {
        return projectsStatus ? json({ error: 'internal' }, projectsStatus) : json(projects.map(id => ({ id, name: `Project ${id}`, status: 'ongoing', team: [] })))
      }
      const m = /\/projects\/([^/]+)\/raci(\?.*)?$/.exec(url)
      if (m && method === 'GET') return w.__raciStatus ? json({ error: 'internal' }, w.__raciStatus) : json(raci[m[1]!] ?? [])
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { role: opts.role ?? 'clinical-writer', projects: opts.projects ?? ['P1'], raci: RACI, raciStatus: opts.raciStatus ?? 0, projectsStatus: opts.projectsStatus ?? 0 })
  await page.goto('/onboarding/a', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-step-body="your-role"]')).toBeVisible({ timeout: 60_000 })
}

const row = (page: Page, id: string) => page.locator(`[data-raci-row="${id}"]`)
const urls = (page: Page) => page.evaluate(() => (window as unknown as { __urls: string[] }).__urls)

test('reads the project’s RACI, never /raci/proj-velora-301, and shows the signed-in user', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-raci-table]')).toBeVisible()
  const called = await urls(page)
  expect(called).toContain('/projects/P1/raci')
  expect(called.filter(u => u.includes('proj-velora-301') || /^\/raci\//.test(u))).toEqual([])

  await expect(page.locator('[data-user-name]')).toHaveText('Mia Member')
  await expect(page.locator('[data-role-heading]')).toHaveText('Clinical Writer')
  // Not swapped for a demo persona: nothing is pinned for later requests or reloads.
  expect(await page.evaluate(() => window.localStorage.getItem('clinwrite.demo.currentUserId'))).toBeNull()
})

test('a saved project assignment counts by person; it replaces the template for that task', async ({ page }) => {
  await open(page)
  // Consulted by name on a-t2 → C.
  await expect(row(page, 'a-t2').locator('[data-raci-mark]')).toHaveText('C')
  await expect(row(page, 'a-t2').locator('[data-raci-word]')).toHaveText('Consulted')
  // The template gives a Clinical Writer R on a-t1, but this project gave it to someone else.
  await expect(row(page, 'a-t1')).toHaveCount(0)
})

test('a task with nothing saved uses the template’s mark for the user’s role', async ({ page }) => {
  await open(page, { projects: ['P2'] })
  await expect(row(page, 'a-t1').locator('[data-raci-mark]')).toHaveText('R')
  await expect(row(page, 'a-t1')).toContainText('Study Start-Up (Stage 1)')
})

test('with several projects the user chooses one, and the rows follow it', async ({ page }) => {
  await open(page, { projects: ['P1', 'P2'] })
  await expect(row(page, 'a-t1')).toHaveCount(0)
  await page.locator('[data-raci-project]').selectOption('P2')
  await expect(row(page, 'a-t1').locator('[data-raci-mark]')).toHaveText('R')
  expect(await urls(page)).toContain('/projects/P2/raci')
})

test('no selector with one project; with no project the template still applies', async ({ page }) => {
  await open(page, { projects: [] })
  await expect(page.locator('[data-raci-project]')).toHaveCount(0)
  await expect(row(page, 'a-t1').locator('[data-raci-mark]')).toHaveText('R')
  expect((await urls(page)).filter(u => /\/projects\/[^/]+\/raci/.test(u))).toEqual([])
})

test('someone with no assignment in the module is told so', async ({ page }) => {
  await open(page, { role: 'contributor', projects: ['P2'] })
  await expect(page.locator('[data-raci-state="empty"]')).toContainText('no RACI assignments')
  await expect(page.locator('[data-raci-table]')).toHaveCount(0)
  await expect(page.locator('[data-role-heading]')).toHaveText('Contributor')
})

test('a failed load says so instead of showing the template, and Try again reloads', async ({ page }) => {
  await open(page, { raciStatus: 500 })
  const err = page.locator('[data-raci-state="error"]')
  await expect(err).toContainText('couldn’t be loaded')
  await expect(page.locator('[data-raci-table]')).toHaveCount(0)
  await page.evaluate(() => { (window as unknown as { __raciStatus: number }).__raciStatus = 0 })
  await err.locator('[data-action="retry-raci"]').click()
  await expect(row(page, 'a-t2')).toBeVisible()
})
