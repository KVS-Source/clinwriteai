// QA regression — All Projects stays on the list when the user has exactly one project.
//
// It used to jump straight into that project, so the list was only ever seen with two or more,
// and a PM with one project could not reach "+ New Project".
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/22-projects-list-single.spec.ts
//
// The project list is answered inside the page; nothing is created.

import { test, expect } from '@playwright/test'

const CONTRIBUTOR = process.env.E2E_CONTRIBUTOR_PERSONA ?? 'cmv7x2f920001gtoivawht3vn'
const PROJECT_ID = 'PROJ-E2E-ONLY'
test.setTimeout(120_000)

test('a user with one project sees it listed and opens it with a click', async ({ page }) => {
  await page.addInitScript(({ persona, projectId }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const project = {
      id: projectId, name: 'Only project', shortTitle: 'Only project', client: 'E2E', indication: 'E2E', phase: 'Phase 1/2',
      therapeuticArea: 'Radiology', status: 'initiated', startDate: '2026-11-04', submissionCountries: ['IN'], activeModules: ['A'],
      documentCount: 1, team: [], tenantId: null, referenceTrial: '', dataCutoff: null, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
    }
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/projects(\?.*)?$/.test(url)) return json([project])
      if (new RegExp(`/projects/${projectId}(\\?.*)?$`).test(url)) return json(project)
      if (url.includes(`/projects/${projectId}/`)) return json([])
      return real(input, init)
    }
  }, { persona: CONTRIBUTOR, projectId: PROJECT_ID })

  await page.goto('/projects', { waitUntil: 'domcontentloaded' })
  const row = page.locator(`[data-project-row="${PROJECT_ID}"]`)
  await expect(row).toBeVisible({ timeout: 60_000 })

  // It has to stay here, not just pass through on the way to the project.
  await page.waitForTimeout(1500)
  await expect(page).toHaveURL(/\/projects$/)
  await expect(row).toBeVisible()

  await row.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_ID}`), { timeout: 15_000 })
})
