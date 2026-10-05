// WCAG 2.1 AA regression suite — closes the Phase 3C "WCAG test harness"
// deferral. Uses @axe-core/playwright to assert zero violations on the
// pages the smoke suite already touches.
//
// Tags filter: WCAG 2A + 2AA + 2.1 AA. Best-practice rules (axe default)
// are disabled here to avoid chasing non-normative recommendations that
// bind us to opinions axe-core may change between versions.
//
// Failure mode: a violation prints the rule id, impact, help URL, and the
// first 3 offending nodes. Enough to triage without opening the HTML
// report. For richer debugging run `npx playwright show-report`.

import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function assertNoA11yViolations(page: Page, path: string): Promise<void> {
  await page.goto(path)
  // Give MSW + initial data load a moment to settle so transient DOM states
  // (skeletons, aria-busy) don't trigger false positives.
  await page.waitForLoadState('networkidle', { timeout: 15_000 })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()

  if (results.violations.length > 0) {
    const summary = results.violations.map(v => {
      const nodes = v.nodes.slice(0, 3)
        .map(n => `  - ${n.target.join(' ')}: ${n.failureSummary ?? ''}`)
        .join('\n')
      return `[${v.impact}] ${v.id} — ${v.help}\n  Help: ${v.helpUrl}\n${nodes}`
    }).join('\n\n')
    throw new Error(`a11y violations on ${path}:\n\n${summary}`)
  }
  expect(results.violations).toEqual([])
}

test('landing (/projects) has no WCAG 2.1 AA violations', async ({ page }) => {
  await assertNoA11yViolations(page, '/projects')
})

test('clinical writing home has no WCAG 2.1 AA violations', async ({ page }) => {
  await assertNoA11yViolations(page, '/projects/velora-301/clinical-writing')
})
