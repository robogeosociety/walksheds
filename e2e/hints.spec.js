import { test, expect } from '@playwright/test'

const STORAGE_KEY = 'walksheds_hints_v1_seen'

test.describe('Hints overlay + Westlake default', () => {
  test('first visit shows hints, auto-selects Westlake, enables sandwich filter', async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.addInitScript((key) => {
      try { localStorage.removeItem(key) } catch {}
    }, STORAGE_KEY)

    await page.goto('/walksheds/')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })

    // Hints overlay is rendered
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.hint-legend')).toBeVisible()
    await expect(page.locator('.hint-search')).toBeVisible()
    await expect(page.locator('.hint-pills')).toBeVisible()

    // Westlake auto-selects after the overview reveal
    await expect(page.locator('.station-pill')).toBeVisible({ timeout: 8000 })

    // Sandwich tag pill is active alongside the default parks + coffee
    await expect(page.locator('.poi-cat-pill', { hasText: 'sandwich' })).toBeVisible({ timeout: 8000 })

    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })

  test('any click dismisses the hint overlay and persists', async ({ page }) => {
    await page.addInitScript((key) => {
      try { localStorage.removeItem(key) } catch {}
    }, STORAGE_KEY)

    await page.goto('/walksheds/')
    await page.waitForSelector('.hint-overlay', { timeout: 10000 })

    // Wait past the arming delay
    await page.waitForTimeout(400)

    // Click on the map canvas dismisses
    await page.locator('.mapboxgl-canvas').click({ position: { x: 200, y: 200 } })
    await expect(page.locator('.hint-overlay')).not.toBeVisible({ timeout: 2000 })

    // Reload — hints stay dismissed
    await page.reload()
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })
    await expect(page.locator('.hint-overlay')).not.toBeVisible({ timeout: 2000 })
  })

  test('?hints force-shows even after dismissal', async ({ page }) => {
    await page.addInitScript((key) => {
      try { localStorage.setItem(key, '1') } catch {}
    }, STORAGE_KEY)

    await page.goto('/walksheds/?hints')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 5000 })
  })

  test('legend help button toggles hints on', async ({ page }) => {
    await page.addInitScript((key) => {
      try { localStorage.setItem(key, '1') } catch {}
    }, STORAGE_KEY)

    await page.goto('/walksheds/')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })
    await expect(page.locator('.hint-overlay')).not.toBeVisible({ timeout: 2000 })

    // Click the ? button in the legend header
    await page.locator('[aria-label="Toggle hints"]').first().click()
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 2000 })
  })
})
