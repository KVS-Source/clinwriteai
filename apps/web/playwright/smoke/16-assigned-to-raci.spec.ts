// QA regression — All Stages "Assigned To": the assignee's name followed by their RACI letter(s) in brackets,
// e.g. "Elena Test (R)"; no initials circle; nothing in brackets when the assignee holds no letter.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/16-assigned-to-raci.spec.ts
//
// The project's document list is answered inside the page; nothing is written.

import { test, expect } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
test.setTimeout(120_000)

const DOCS = [
  { id: 'DOC-E2E-AT-1', name: 'Elena Test', initials: 'ET', raci: ['R'] },
  { id: 'DOC-E2E-AT-2', name: 'Ravi Test',  initials: 'RT', raci: ['R', 'C'] },
  { id: 'DOC-E2E-AT-3', name: 'Nora Test',  initials: 'NT', raci: [] as string[] },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ projectId, docs }) => {
    const list = docs.map((d, i) => ({
      id: d.id, projectId, type: 'protocol', title: `Assignee test ${i + 1}`, status: 'in-authoring',
      stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: `u-e2e-${i}`,
      assigneeName: d.name, assigneeInitials: d.initials, assigneeRaci: d.raci,
      updatedAt: `2026-10-2${i}T09:00:00Z`, sections: [],
    }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new RegExp(`/projects/${projectId}/documents(\\?.*)?$`).test(url) && (init?.method ?? 'GET').toUpperCase() === 'GET') {
        return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return real(input, init)
    }
  }, { projectId: PROJECT_ID, docs: DOCS })
})

test('Assigned To shows "Name (letters)", no initials circle, and no brackets without a letter', async ({ page }) => {
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  const cell = (id: string) => page.locator(`[data-doc-row="${id}"] [data-assignee-cell]`)
  await expect(cell('DOC-E2E-AT-1')).toBeVisible({ timeout: 60_000 })

  await expect(cell('DOC-E2E-AT-1')).toHaveText('Elena Test (R)')
  await expect(cell('DOC-E2E-AT-2')).toHaveText('Ravi Test (R, C)')
  await expect(cell('DOC-E2E-AT-3')).toHaveText('Nora Test')
  await expect(cell('DOC-E2E-AT-3').locator('[data-assignee-raci]')).toHaveCount(0)

  // the initials circle is gone: the initials appear nowhere in the row
  for (const d of DOCS) {
    await expect(page.locator(`[data-doc-row="${d.id}"]`).getByText(d.initials, { exact: true })).toHaveCount(0)
  }
})
