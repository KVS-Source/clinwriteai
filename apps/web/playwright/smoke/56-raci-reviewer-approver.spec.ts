// QA regression — a Reviewer (C) can also be an Approver (A) on the same document, and the other way round.
// Every other pair stays apart: an Author (R) is still greyed out in the Approver and Reviewer pickers.
//
//   E2E_BASE_URL=http://localhost:5173 npx playwright test playwright/smoke/56-raci-reviewer-approver.spec.ts
//
// The RACI rows are answered inside the page, including the POST; nothing is written.

import { test, expect, type Page } from '@playwright/test'
import { PROTOTYPE_PROJECT_ID } from '../helpers/auth'

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? PROTOTYPE_PROJECT_ID
const PM_PERSONA = process.env.E2E_PM_PERSONA ?? 'user-sa'
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
        const added = { ...template, id: `new-${body.userId}`, userId: body.userId, userName: body.userId === 'u-ravi' ? 'Ravi' : 'Raj', letter: body.letter }
        state.rows = [...state.rows, added]
        return json(added, 201)
      }
      if (/\/projects\/[^/]+\/assignable-users/.test(url)) {
        return json([
          { id: 'u-ravi', name: 'Ravi', email: 'ravi@example.com', initials: 'RV', capabilities: ['can-review', 'can-approve'], projectRole: null },
          { id: 'u-r1', name: 'Raj', email: 'raj@example.com', initials: 'RA', capabilities: ['can-author'], projectRole: null },
        ])
      }
      return real(input, init)
    }
  }, { rows: [row('r1', 'Raj', 'R'), { ...row('c1', 'Ravi', 'C'), userId: 'u-ravi' }], canEdit: opts.canEdit, refuse: !!opts.refuse, refuseAdd: !!opts.refuseAdd, persona: PM_PERSONA, template: row('t', 't', 'R') })

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

const assigned = (page: Page) => page.evaluate(() => (window as unknown as { __raci: { assigned: Array<{ userId: string; letter: string }> } }).__raci.assigned)
const picker = (page: Page, letter: string) => page.locator(`[data-raci-letter="${letter}"]`)

test('the Reviewer Ravi can be added as an Approver too', async ({ page }) => {
  await open(page, { canEdit: true })
  const approvers = picker(page, 'A')
  await approvers.locator('input[type="search"]').fill('ravi')
  const ravi = approvers.locator('[data-user-result="u-ravi"]')
  await expect(ravi).toHaveAttribute('data-result-state', 'available')
  await expect(ravi.locator('[data-held-elsewhere]')).toHaveCount(0)
  await ravi.click()
  await expect.poll(() => assigned(page)).toEqual([expect.objectContaining({ userId: 'u-ravi', letter: 'A' })])
  // Ravi is listed under both letters.
  await expect(picker(page, 'A')).toContainText('Ravi')
  await expect(picker(page, 'C')).toContainText('Ravi')
})

test('the Author Raj is still greyed out as an Approver and as a Reviewer', async ({ page }) => {
  await open(page, { canEdit: true })
  for (const letter of ['A', 'C']) {
    const box = picker(page, letter)
    await box.locator('input[type="search"]').fill('raj')
    const raj = box.locator('[data-user-result="u-r1"]')
    await expect(raj).toHaveAttribute('data-result-state', 'held-elsewhere')
    await expect(raj.locator('[data-held-elsewhere]')).toHaveText('Already R')
  }
})
