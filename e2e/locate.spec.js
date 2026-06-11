import { test, expect } from '@playwright/test'

// Locate-control compass session (issue #16 follow-up): device
// orientation rotates the map only between activating the locate
// control and navigating away — swiping to another station must end
// the session and return the map to north-up. Uses the dev-only
// window.__mapForTest handle and synthetic deviceorientationabsolute
// events (Chromium has no permission gate; the iOS permission race is
// covered in src/__tests__/useCompass.test.jsx).

test.use({
  // Just east of Capitol Hill Station — inside the snap corridor.
  geolocation: { longitude: -122.3168, latitude: 47.6185 },
  permissions: ['geolocation'],
})

const getBearing = (page) => page.evaluate(() => window.__mapForTest?.getBearing())

const fireOrientation = (page, alpha) => page.evaluate((a) => {
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: a, absolute: true }))
}, alpha)

const swipeUp = (page) => page.evaluate(() => {
  const target = document.querySelector('.mapboxgl-canvas')
  const mk = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y })
  window.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(640, 500)], changedTouches: [mk(640, 500)] }))
  window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [mk(640, 380)] }))
})

test('compass rotation ends when swiping to another station', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.station-pill', { timeout: 20000 })

  // Activate locate: snaps to Capitol Hill and starts the compass session.
  await page.locator('.mapboxgl-ctrl-geolocate').click()
  await page.waitForFunction(
    () => document.querySelector('.station-pill')?.textContent.includes('Capitol Hill'),
    null, { timeout: 15000 },
  )
  await page.waitForTimeout(1500)

  // Orientation rotates the map (alpha 270 = compass heading 90).
  await fireOrientation(page, 270)
  await expect.poll(() => getBearing(page), { timeout: 5000 }).toBeCloseTo(90, 0)

  // Swipe up rides to Westlake — and must end the orientation session.
  await swipeUp(page)
  await page.waitForFunction(
    () => document.querySelector('.station-pill')?.textContent.includes('Westlake'),
    null, { timeout: 8000 },
  )
  await expect.poll(async () => Math.abs(await getBearing(page)), { timeout: 5000 }).toBeLessThan(1)

  // Further orientation events must not rotate the map.
  await fireOrientation(page, 180)
  await page.waitForTimeout(600)
  expect(Math.abs(await getBearing(page))).toBeLessThan(1)
})
