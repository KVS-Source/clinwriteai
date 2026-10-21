import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

// CRM (PRD stage 5) on the real lifecycle endpoints. Mock mode: the seeded
// DOC-001 meeting is in progress with pending comments — resolve each one
// (note required), then End meeting completes it. Live API: just check the
// screen renders a meeting or the schedule form / explanation.
test('Module A — CRM: resolve pending comments and end the meeting', async ({ page }) => {
  await visitModule(page, 'clinical-writing/crm')
  const screen = page.locator('[data-screen="crm-module"]')
  await expect(screen).toBeVisible({ timeout: 15_000 })

  const picker = page.locator('[data-crm-doc-picker]')
  if (await picker.locator('option[value="DOC-001"]').count()) await picker.selectOption('DOC-001')

  if ((await screen.getAttribute('data-meeting-status')) !== 'in_progress') {
    await expect(page.locator('[data-crm-schedule], [data-crm-start], [data-crm-complete], [data-screen="crm-module"] p').first()).toBeVisible()
    return
  }

  // Resolve every pending comment through the resolution panel.
  for (let i = 0; i < 10; i++) {
    const active = page.locator('[data-crm-comment][data-state="active"]')
    if (!(await active.count())) break
    const id = await active.getAttribute('data-crm-comment')
    await active.locator('[data-resolve="accept"]').click()
    await page.locator('textarea').last().fill('Agreed in the meeting — wording updated.')
    await page.getByRole('button', { name: /sign and confirm resolution/i }).click()
    await expect(page.locator(`[data-crm-comment="${id}"][data-state="resolved"]`)).toBeVisible({ timeout: 10_000 })
  }

  await page.locator('[data-crm-end]').click()
  await expect(page.locator('[data-crm-complete]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-crm-to-signature]')).toBeVisible()
})
