import { defineConfig, devices } from '@playwright/test'

// e2e tests run against a fully running stack (docker compose, or `dev` + backend
// locally) — see README's "End-to-end tests" section. They are not started by this
// config because the stack includes the API, worker and bot, not just the frontend.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
