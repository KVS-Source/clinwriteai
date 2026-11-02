// QA regression — All Stages "Assigned To".
//   Admin: the assignee's name followed by their RACI letter(s) in brackets, e.g. "Elena Test (R)"; no initials
//   circle; nothing in brackets when the assignee holds no letter.
//   Contributor: the assignee's name, then the contributor's own letters on that document, e.g. "Ms Laura Kim: C".
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
  { id: 'DOC-E2E-AT-1', name: 'Elena Test', initials: 'ET', raci: ['R'],      mine: ['C'] },
  { id: 'DOC-E2E-AT-2', name: 'Ravi Test',  initials: 'RT', raci: ['R', 'C'], mine: ['A', 'I'] },
  { id: 'DOC-E2E-AT-3', name: 'Nora Test',  initials: 'NT', raci: [] as string[], mine: [] as string[] },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ projectId, docs }) => {
    const list = docs.map((d, i) => ({
      id: d.id, projectId, type: 'protocol', title: `Assignee test ${i + 1}`, status: 'in-authoring',
      stage: 'study-start-up', version: 'v0.1', therapeuticArea: 'Oncology', assigneeId: `u-e2e-${i}`,
      assigneeName: d.name, assigneeInitials: d.initials, assigneeRaci: d.raci, myRaci: d.mine,
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

const persona = (page: import('@playwright/test').Page, id: string) =>
  page.addInitScript(pid => { sessionStorage.setItem('clinwrite.demo.currentUserId', pid); localStorage.setItem('clinwrite.demo.currentUserId', pid) }, id)

test('Admin: Assigned To shows "Name (letters)", no initials circle, and no brackets without a letter', async ({ page }) => {
  await persona(page, 'user-admin')
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

test("Contributor: Assigned To shows the assignee, then the contributor's own letters per document", async ({ page }) => {
  await persona(page, 'user-auth')   // Ms Laura Kim, author
  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  const cell = (id: string) => page.locator(`[data-doc-row="${id}"] [data-assignee-cell]`)
  await expect(cell('DOC-E2E-AT-1')).toBeVisible({ timeout: 60_000 })

  await expect(cell('DOC-E2E-AT-1').locator('[data-my-raci]')).toHaveText('Ms Laura Kim: C')
  await expect(cell('DOC-E2E-AT-2').locator('[data-my-raci]')).toHaveText('Ms Laura Kim: A, I')
  await expect(cell('DOC-E2E-AT-3').locator('[data-my-raci]')).toHaveCount(0)
  // the assignee's own letters are not shown to contributors
  await expect(cell('DOC-E2E-AT-1')).toContainText('Elena Test')
  await expect(page.locator('[data-assignee-raci]')).toHaveCount(0)
})
