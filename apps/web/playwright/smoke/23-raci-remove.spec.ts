// QA regression — each person on a document's RACI has a Remove button, with Cancel before it happens.
//
//   E2E_BASE_URL=http://localhost:5173 E2E_PROJECT_ID=PROJ-AURORA \
//     npx playwright test playwright/smoke/23-raci-remove.spec.ts
//
// The RACI rows are answered inside the page, including the DELETE; nothing is written.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'   // sees the project's documents; can-edit is answered below
test.setTimeout(120_000)

const row = (id: string, userName: string, letter: string) => ({
  id, documentId: 'd', userId: `u-${id}`, userName, letter, sectionId: null, approvalOrder: null, signatureRequired: false, signatureMeaning: null,
  submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null, assignedBy: 'x', assignedAt: '2026-11-01T00:00:00Z', removedAt: null,
})

async function open(page: Page, opts: { canEdit: boolean; refuse?: boolean; refuseAdd?: boolean }) {
  await page.addInitScript(({ rows, canEdit, refuse, refuseAdd, persona, template }) => {
    window.localStorage.setItem('clinwrite.demo.currentUserId', persona)
    const state = { rows: rows as Array<{ id: string }>, deleted: [] as string[], assigned: [] as Array<{ userId: string; letter: string }> }
    ;(window as unknown as { __raci: typeof state }).__raci = state
    const json = (b: unknown, s = 200) => Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }))
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (/\/documents\/[^/]+\/raci\/can-edit/.test(url)) return json({ canEdit })
      const del = /\/documents\/[^/]+\/raci\/([^/?]+)$/.exec(url)
      if (del && method === 'DELETE') {
        if (refuse) return json({ error: 'last_author', message: 'This is the only author on the document.' }, 409)
        state.deleted.push(del[1]!)
        state.rows = state.rows.filter(r => r.id !== del[1])
        return json(null, 204)
      }
      if (/\/documents\/[^/?]+\/raci(\?.*)?$/.test(url) && method === 'GET') return json(state.rows)
      if (/\/documents\/[^/?]+\/raci(\?.*)?$/.test(url) && method === 'POST') {
        if (refuseAdd) return json({ error: 'duplicate_letter_on_section', message: 'User already holds letter C on this section' }, 409)
        const body = JSON.parse(String(init?.body)) as { userId: string; letter: string }
        state.assigned.push(body)
        const added = { ...template, id: `new-${body.userId}`, userId: body.userId, userName: 'Anjalee Test', letter: body.letter }
        state.rows = [...state.rows, added]
        return json(added, 201)
      }
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) {
        return json([
          { id: 'u-anjalee', name: 'Anjalee Test', email: 'anjalee@example.com', initials: 'AT', capabilities: ['can-author', 'can-approve'], projectRole: null },
          { id: 'u-r1', name: 'Raj', email: 'raj@example.com', initials: 'RA', capabilities: ['can-author'], projectRole: null },
        ])
      }
      return real(input, init)
    }
  }, { rows: [row('r1', 'Raj', 'R'), row('r2', 'Sheetal', 'R'), row('i1', 'Priya', 'I')], canEdit: opts.canEdit, refuse: !!opts.refuse, refuseAdd: !!opts.refuseAdd, persona: PM_PERSONA, template: row('t', 't', 'R') })

  await page.goto(`/projects/${PROJECT_ID}/clinical-writing`)
  await page.waitForSelector('[data-doc-row]', { timeout: 60_000 })
  const rows = page.locator('[data-doc-row]')
  for (let i = 0, n = await rows.count(); i < n; i++) {
    await rows.nth(i).click()
    const btn = page.locator('[data-action="open-raci"]')
    if (await btn.isVisible().catch(() => false)) { await btn.click(); break }
  }
  await expect(page.locator('[data-raci-row="r1"]')).toBeVisible({ timeout: 30_000 })
}

const deleted = (page: Page) => page.evaluate(() => (window as unknown as { __raci: { deleted: string[] } }).__raci.deleted)

test('Cancel keeps the person; Remove takes them off, Informed included', async ({ page }) => {
  await open(page, { canEdit: true })
  const sheetal = page.locator('[data-raci-row="r2"]')

  await sheetal.locator('[data-action="remove-raci"]').click()
  await sheetal.locator('[data-action="cancel-remove-raci"]').click()
  await expect(sheetal.locator('[data-action="remove-raci"]')).toBeVisible()
  expect(await deleted(page)).toEqual([])

  await sheetal.locator('[data-action="remove-raci"]').click()
  await sheetal.locator('[data-action="confirm-remove-raci"]').click()
  await expect(sheetal).toHaveCount(0)
  expect(await deleted(page)).toEqual(['r2'])

  // Informed people are listed and removable too.
  const priya = page.locator('[data-raci-row="i1"]')
  await expect(priya).toContainText('Priya')
  await priya.locator('[data-action="remove-raci"]').click()
  await priya.locator('[data-action="confirm-remove-raci"]').click()
  await expect(priya).toHaveCount(0)
})

test('adding someone is plain to see: the search closes, their row is marked, and a message confirms it', async ({ page }) => {
  await open(page, { canEdit: true })
  const box = page.getByLabel('Filter users').first()   // R section
  await box.fill('anjalee')
  const result = page.locator('[data-user-result="u-anjalee"]').first()
  await expect(result).toContainText('Add')
  await expect(page.locator('[data-user-results] input[type="checkbox"]')).toHaveCount(0)
  await result.click()

  await expect(page.locator('[data-raci-added]')).toContainText('Anjalee Test added to Responsible')
  await expect(page.locator('[data-raci-row="new-u-anjalee"]')).toHaveAttribute('data-just-added', 'true')
  await expect(page.locator('[data-user-results]')).toHaveCount(0)
  await expect(box).toHaveValue('')
  expect(await page.evaluate(() => (window as unknown as { __raci: { assigned: unknown[] } }).__raci.assigned)).toEqual([{ userId: 'u-anjalee', letter: 'R' }])

  // Searching again shows they are already added; they cannot be taken off from the search list.
  await box.fill('anjalee')
  const again = page.locator('[data-user-result="u-anjalee"]').first()
  await expect(again).toHaveAttribute('data-result-state', 'added')
  await expect(again).toContainText('Added')
  await expect(again).toBeDisabled()

  // The highlight settles; the person stays on the list.
  await box.fill('')
  await expect(page.locator('[data-raci-added]')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('[data-raci-row="new-u-anjalee"]')).toContainText('Anjalee Test')
  await expect(page.locator('[data-raci-row="new-u-anjalee"]')).not.toHaveAttribute('data-just-added', 'true')
})

test('a refused add shows why, keeps the search open, and claims nothing', async ({ page }) => {
  await open(page, { canEdit: true, refuseAdd: true })
  const box = page.getByLabel('Filter users').first()
  await box.fill('anjalee')
  await page.locator('[data-user-result="u-anjalee"]').first().click()
  await expect(page.locator('[data-raci-letter-error]')).toContainText('already holds')
  await expect(page.locator('[data-raci-added]')).toHaveCount(0)
  await expect(box).toHaveValue('anjalee')
})

test('a letter with no one on it says so', async ({ page }) => {
  await open(page, { canEdit: true })
  await expect(page.locator('[data-raci-empty]').first()).toContainText('No one assigned yet')
})

test('the panel has no e-signature controls', async ({ page }) => {
  await open(page, { canEdit: true })
  await expect(page.locator('[data-raci-row]')).toHaveCount(3)
  await expect(page.locator('[data-raci-row] input[type="checkbox"]')).toHaveCount(0)
  await expect(page.locator('[data-raci-row] select')).toHaveCount(0)
  await expect(page.getByText('Requires e-signature')).toHaveCount(0)
})

test('a refusal from the server is shown, and the person stays', async ({ page }) => {
  await open(page, { canEdit: true, refuse: true })
  const raj = page.locator('[data-raci-row="r1"]')
  await raj.locator('[data-action="remove-raci"]').click()
  await raj.locator('[data-action="confirm-remove-raci"]').click()
  await expect(page.locator('[data-raci-letter-error]')).toContainText('only author')
  await expect(raj).toBeVisible()
})

test('someone who cannot edit the RACI sees no Remove button', async ({ page }) => {
  await open(page, { canEdit: false })
  await expect(page.locator('[data-action="remove-raci"]')).toHaveCount(0)
})
