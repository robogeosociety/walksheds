import { test, expect } from '@playwright/test'

// Minimal liveness probe consumed by the Grafana uptime dashboard. Kept small
// and interaction-free on purpose: it answers "is the site serving and does the
// map render?", not feature behavior (that's smoke.spec.js / hints.spec.js).
test('site is up and the map renders', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page).toHaveTitle(/Walksheds/)
  await expect(page.locator('.mapboxgl-canvas')).toBeVisible({ timeout: 20000 })
})
