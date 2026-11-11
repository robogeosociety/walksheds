import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://localhost:5187',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        // hints.spec.js covers the flagged-off hint overlay, so turn it on.
        command: 'VITE_FEATURE_HINTS=1 npm run dev',
        port: 5187,
        reuseExistingServer: true,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
