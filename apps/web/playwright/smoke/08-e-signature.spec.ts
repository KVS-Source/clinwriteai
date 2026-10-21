import { test, expect } from '@playwright/test'
import { visitModule } from '../helpers/auth'

// E-Signature (FR-A-066) wired to the chain API. Works in both suites:
//  • MSW on  — the mock chain has the signed-in user's step awaiting, so the
//    test signs it and checks the chain advances (progress + row state).
//  • Live API — no chain may exist yet, so it checks the screen offers the
//    initiate panel (or explains why the chain can't start yet).
test('Module A — e-signature: sign the awaiting step or offer chain initiation', async ({ page }) => {
  await visitModule(page, 'clinical-writing/documents/DOC-001/sign')
  await expect(page.locator('[data-screen="e-signature"]')).toBeVisible({ timeout: 15_000 })

  const signButton = page.locator('[data-sign-submit]')
  if (await signButton.isVisible().catch(() => false)) {
    const progress = page.locator('[data-signature-progress]')
    const before = await progress.innerText()
    const signedBefore = await page.locator('[data-signer-id][data-state="signed"]').count()

    await page.locator('[data-credential-input]').fill('test-password-123')
    await signButton.click()

    await expect(page.locator('[data-signer-id][data-state="signed"]')).toHaveCount(signedBefore + 1, { timeout: 10_000 })
    await expect(progress).not.toHaveText(before)
    await expect(page.locator('[data-sign-error]')).toHaveCount(0)
  } else {
    await expect(
      page.locator('[data-initiate-chain], [data-initiate-blocked], [data-signer-id]').first(),
    ).toBeVisible({ timeout: 10_000 })
  }
})
