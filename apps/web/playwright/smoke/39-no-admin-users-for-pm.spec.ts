// QA regression — GET /admin/users is for Tenant Admins only. Clinical Writing Home, the Editor, Reviewer View, Version
// Diff, CRM, Project Settings and New Document used to call it on every load, so a PM got a 403 (a red console error) on
// each page and names could fall back to ids. They now read the project's people from
// GET /projects/:id/assignable-users, and no longer call /admin/users at all.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_CHANNEL=msedge \
//     npx playwright test playwright/smoke/39-no-admin-users-for-pm.spec.ts
//
// /auth/me (a PM), the project, its documents and people are answered inside the page and the calls recorded; nothing
// is written. /admin/users answers 403 as the API does. Any other API call that comes back 401 is turned into a 503.

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(120_000)

const PROJECT = 'PROJ-E2E-PPL'
const DOC = 'DOC-E2E-PPL'

async function open(page: Page, path: string, status = 'in-review') {
  await page.addInitScript(({ project, doc, status }) => {
    const me = { id: 'u-pm', email: 'pm@x.io', name: 'Pat Manager', role: 'pm', roles: ['pm'], modules: ['A'], status: 'active', lastActiveAt: null, tenantId: 'T1' }
    const w = window as unknown as { __urls: string[] }
    w.__urls = []
    const document = {
      id: doc, projectId: project, type: 'protocol', title: 'Protocol 9', status, stage: 'cross-functional-review', version: 'v0.2',
      therapeuticArea: 'Oncology', assigneeId: 'u-gone', createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z',
      sections: [{ id: 's1', number: '1', title: 'Synopsis', status: 'complete', contentHtml: '<p>Synopsis text.</p>' }],
    }
    const people = [
      { id: 'u-pm', name: 'Pat Manager', initials: 'PM', status: 'active' },
      { id: 'u-gone', name: 'Sam Suspended', initials: 'SS', status: 'suspended' },
      { id: 'u-live', name: 'Lee Live', initials: 'LL', status: 'active' },
    ]
    const candidates = [
      { id: 'u-pm', name: 'Pat Manager', email: 'pm@x.io', initials: 'PM', capabilities: [], projectRole: null },
      { id: 'u-live', name: 'Lee Live', email: 'lee@x.io', initials: 'LL', capabilities: ['can-author'], projectRole: 'Writer' },
    ]
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const u = new URL(url, window.location.href)
      w.__urls.push(u.pathname + u.search)
      if (/\/auth\/me$/.test(u.pathname)) return json(me)
      if (/\/admin\/users$/.test(u.pathname)) return json({ error: 'forbidden', message: 'Admins only' }, 403)
      if (u.pathname.endsWith(`/projects/${project}/assignable-users`)) return json(u.searchParams.get('scope') === 'people' ? people : candidates)
      if (u.pathname.endsWith(`/projects/${project}/documents`) && method === 'GET') return json([document])
      if (u.pathname.endsWith(`/projects/${project}/source-documents/access`)) return json({ canView: true, canUpload: false })
      if (u.pathname.endsWith(`/projects/${project}/source-documents`)) return json({ items: [{ id: 'up-1', title: 'Protocol v3', fileName: 'protocol.pdf', fileSizeBytes: 1000, contentType: 'application/pdf', previewable: true, category: 'protocol', state: 'accepted', virusScanStatus: 'clean', uploadedAt: '2026-10-01T09:00:00Z' }], total: 1, page: 1, pageSize: 100, summary: { files: 1, totalBytes: 1000, categories: 1 } })
      if (u.pathname.endsWith(`/projects/${project}/status`)) return json({ status: 'ongoing', next: ['on-hold', 'closed'], history: [] })
      if (u.pathname.endsWith(`/projects/${project}`) && method === 'GET') {
        return json({ id: project, name: 'People Project', shortTitle: 'People', status: 'ongoing', therapeuticArea: 'Oncology', tenantId: 'T1', activeModules: ['A'], submissionCountries: [], team: [{ userId: 'u-pm', name: 'Pat Manager', initials: 'PM', role: 'Lead', raci: 'R' }], createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-11-01T09:00:00Z' })
      }
      if (/\/projects$/.test(u.pathname) && method === 'GET') return json([])
      if (u.pathname.endsWith(`/documents/${doc}`) && method === 'GET') return json(document)
      if (u.pathname.endsWith(`/documents/${doc}/ai-draft-status`)) return json({ state: 'idle', confidenceOverall: null, sections: [], lastPassNumber: 0 })
      if (u.pathname.endsWith(`/documents/${doc}/raci/can-edit`)) return json({ canEdit: false, chainActive: false })
      if (u.pathname.endsWith(`/documents/${doc}/raci`)) return json([{ id: 'r1', documentId: doc, userId: 'u-gone', letter: 'R', sectionId: null, removedAt: null, rejectedAt: null, submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, signatureRequired: false, signatureMeaning: null, approvalOrder: null }])
      if (u.pathname.endsWith(`/documents/${doc}/presence`)) return json({ documentId: doc, sections: [{ sectionId: 's1', users: [{ userId: 'u-gone', sessionId: 'x', lastSeenAt: new Date().toISOString() }] }] })
      if (u.pathname.includes(`/documents/${doc}/`)) return json(method === 'GET' ? [] : {})
      const res = await real(input, init)
      return res.status === 401 ? json({ error: 'e2e_no_session' }, 503) : res
    }
  }, { project: PROJECT, doc: DOC, status })
  await page.goto(`/projects/${PROJECT}${path}`, { waitUntil: 'domcontentloaded' })
}

const urls = (page: Page) => page.evaluate(() => (window as unknown as { __urls: string[] }).__urls)
const expectNoAdminUsers = async (page: Page) => {
  await page.waitForTimeout(1500)      // let the page's queries all fire
  const called = await urls(page)
  expect(called.filter(u => /\/admin\/users(\?|$)/.test(u))).toEqual([])
}

test('Clinical Writing Home: no call to /admin/users; a suspended assignee still shows by name', async ({ page }) => {
  await open(page, '/clinical-writing')
  const row = page.locator(`[data-doc-row="${DOC}"]`)
  await expect(row).toContainText('Sam Suspended', { timeout: 60_000 })
  await expectNoAdminUsers(page)
  expect(await urls(page)).toContain(`/projects/${PROJECT}/assignable-users?scope=people`)
})

for (const [name, path, selector, status] of [
  ['Editor', `/clinical-writing/documents/${DOC}`, '[data-screen="document-editor"]', 'in-authoring'],
  ['Reviewer View', `/clinical-writing/documents/${DOC}/review`, '[data-screen="reviewer-view"]', 'in-review'],
  ['Version Diff', `/clinical-writing/documents/${DOC}/diff`, '[data-screen="diff-view"]', 'in-authoring'],
  ['CRM', `/clinical-writing/documents/${DOC}/crm`, '[data-screen="crm-module"], [data-action="schedule-meeting"], form', 'crm-in-progress'],
] as const) {
  test(`${name}: no call to /admin/users`, async ({ page }) => {
    await open(page, path, status)
    await expect(page.locator(selector).first()).toBeVisible({ timeout: 60_000 })
    await expectNoAdminUsers(page)
  })
}

test('RACI editor: the assigned person shows by name, not id', async ({ page }) => {
  await open(page, '/clinical-writing')
  await page.locator(`[data-doc-row="${DOC}"]`).click({ timeout: 60_000 })
  await page.locator('[data-panel="document-detail"] [data-action="open-raci"]').click()
  await expect(page.locator('[data-raci-row="r1"]')).toContainText('Sam Suspended', { timeout: 30_000 })
  await expect(page.locator('[data-raci-row="r1"]')).not.toContainText('u-gone')
  await expectNoAdminUsers(page)
})

test('Project Settings > Add member (project Author): picks from the project’s candidates', async ({ page }) => {
  await open(page, '/settings')
  await page.locator('[data-action="add-member"]').click({ timeout: 60_000 })
  const select = page.locator('[data-field="user"]')
  await expect(select.locator('option', { hasText: 'Lee Live' })).toHaveCount(1, { timeout: 30_000 })
  await expectNoAdminUsers(page)
  expect(await urls(page)).toContain(`/projects/${PROJECT}/assignable-users`)
})

test('New Document: the assignee list comes from the project’s candidates', async ({ page }) => {
  await open(page, '/clinical-writing')
  await page.getByRole('button', { name: /New Document/ }).first().click({ timeout: 60_000 })
  await expect(page.locator('[data-form="new-document"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-action="wizard-next"]').dispatchEvent('click')          // type -> sources
  await page.locator('[data-source-id="up-1"]').check()
  await page.locator('[data-action="wizard-next"]').dispatchEvent('click')          // sources -> details
  const field = page.locator('[data-step-body="details"] [data-field="assignee"] input')
  await field.click()
  await expect(page.locator('[data-field="assignee"] [role="option"]').filter({ hasText: 'Lee Live (Writer)' })).toHaveCount(1)
  await expectNoAdminUsers(page)
  expect(await urls(page)).toContain(`/projects/${PROJECT}/assignable-users?scope=assignee`)
})
