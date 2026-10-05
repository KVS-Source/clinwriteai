// Playwright regression suite — one happy-path smoke per module.
//
// Why minimal: the prototype has thousands of UI states; attempting broad
// coverage before cutover is lost work (every real-API swap in Phase 3 will
// break selectors). These five tests exist as a "did we tip something over"
// gate — if any fails, we broke a module landing page. Depth comes module-
// by-module once the real API lands for each.
//
// Runs against the built static bundle via vite preview — same code CI
// deploys, no dev-server quirks.

import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 4173)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './playwright',
  fullyParallel: false,          // one page under test at a time keeps selectors stable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined   // caller provided their own URL (e.g. a deployed staging)
    : {
        command: `npx vite preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
