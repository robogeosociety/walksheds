import { test, expect } from '@playwright/test'

const STORAGE_KEY = 'walksheds_hints_v1_seen'

test.describe('Hints overlay + Westlake default', () => {
  test('first visit shows hints, auto-selects Westlake, enables sandwich filter', async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.addInitScript((key) => {
      try { localStorage.removeItem(key) } catch {}
    }, STORAGE_KEY)

    await page.goto('/')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })

    // Hints overlay is rendered
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.hint-legend')).toBeVisible()
    await expect(page.locator('.hint-search')).toBeVisible()
    await expect(page.locator('.hint-pills')).toBeVisible()

    // Westlake auto-selects after the overview reveal
    await expect(page.locator('.station-pill')).toBeVisible({ timeout: 8000 })

    // Default category tag pills (coffee + park) are seeded
    await expect(page.locator('.poi-cat-pill', { hasText: 'coffee' })).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.poi-cat-pill', { hasText: 'park' })).toBeVisible({ timeout: 8000 })

    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })

  test('any click dismisses the hint overlay and persists', async ({ page }) => {
    await page.addInitScript((key) => {
      try { localStorage.removeItem(key) } catch {}
    }, STORAGE_KEY)

    await page.goto('/')
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

    await page.goto('/?hints')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 5000 })
  })

  test('legend help button toggles hints on', async ({ page }) => {
    await page.addInitScript((key) => {
      try { localStorage.setItem(key, '1') } catch {}
    }, STORAGE_KEY)

    await page.goto('/')
    await page.waitForSelector('.mapboxgl-canvas', { timeout: 15000 })
    await expect(page.locator('.hint-overlay')).not.toBeVisible({ timeout: 2000 })

    // Click the ? button in the legend header
    await page.locator('[aria-label="Toggle hints"]').first().click()
    await expect(page.locator('.hint-overlay')).toBeVisible({ timeout: 2000 })
  })
})

// Anchored hints (issue #45 follow-up): labels and arrows are generated
// from live measurements of their target controls, so the tips must land
// on the controls — and follow them when they move.
test.describe('Hint anchoring + visibility', () => {
  const TARGET_FOR = {
    legend: '.line-legend',
    search: '.poi-search-input-row',
    pills: '.poi-cat-pills',
    filters: '.poi-filter-list, .poi-cat-pills',
  }

  async function arrowTips(page) {
    return page.evaluate(() => [...document.querySelectorAll('[data-hint-arrow]')].map(g => ({
      id: g.getAttribute('data-hint-arrow'),
      x: Number(g.getAttribute('data-x2')),
      y: Number(g.getAttribute('data-y2')),
    })))
  }

  async function expectTipsOnTargets(page) {
    const tips = await arrowTips(page)
    expect(tips.length).toBeGreaterThanOrEqual(3)
    for (const tip of tips) {
      const box = await page.locator(TARGET_FOR[tip.id]).first().boundingBox()
      expect(box, `target for ${tip.id}`).toBeTruthy()
      const pad = 16
      // The dimmed filters fallback points just below the pill row.
      const padBottom = tip.id === 'filters' ? 24 : pad
      expect(tip.x, `${tip.id} arrow x`).toBeGreaterThanOrEqual(box.x - pad)
      expect(tip.x, `${tip.id} arrow x`).toBeLessThanOrEqual(box.x + box.width + pad)
      expect(tip.y, `${tip.id} arrow y`).toBeGreaterThanOrEqual(box.y - pad)
      expect(tip.y, `${tip.id} arrow y`).toBeLessThanOrEqual(box.y + box.height + padBottom)
    }
  }

  test('hint arrows point at their target controls', async ({ page }) => {
    await page.goto('/?hints')
    await page.waitForSelector('.hint-overlay', { timeout: 15000 })
    await page.waitForSelector('.poi-cat-pills', { timeout: 15000 })
    await page.waitForTimeout(600)
    await expectTipsOnTargets(page)
  })

  test('hints follow the legend when it collapses', async ({ page }) => {
    await page.goto('/?hints')
    await page.waitForSelector('.hint-overlay', { timeout: 15000 })
    await page.waitForTimeout(600)
    const before = (await arrowTips(page)).find(t => t.id === 'legend')
    // The collapse chevron is data-hint-keep, so hints survive the click.
    await page.locator('[aria-label="Collapse legend"]').click()
    await page.waitForSelector('.line-legend.collapsed', { timeout: 3000 })
    await page.waitForTimeout(900)
    await expect(page.locator('.hint-overlay')).toBeVisible()
    const after = (await arrowTips(page)).find(t => t.id === 'legend')
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40)
    await expectTipsOnTargets(page)
  })

  test('hint ink is readable over the basemap in both modes', async ({ page }) => {
    await page.goto('/?hints')
    await page.waitForSelector('.hint-label', { timeout: 15000 })
    const MAP_BG = { light: [242, 239, 233], dark: [52, 52, 63] }
    const audit = (mapBg) => {
      const lum = ([r, g, b]) => {
        const ch = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
      }
      const el = document.querySelector('.hint-label')
      const cs = getComputedStyle(el)
      const ink = cs.color.match(/\d+/g).map(Number).slice(0, 3)
      const la = lum(ink); const lb = lum(mapBg)
      return {
        contrast: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05),
        hasHalo: cs.textShadow !== 'none',
      }
    }
    const light = await page.evaluate(audit, MAP_BG.light)
    expect(light.hasHalo, 'light halo present').toBe(true)
    expect(light.contrast, 'light ink vs day basemap').toBeGreaterThanOrEqual(4.5)
    await page.keyboard.press('d')
    await page.waitForSelector('.app.dark', { timeout: 3000 })
    const dark = await page.evaluate(audit, MAP_BG.dark)
    expect(dark.hasHalo, 'dark halo present').toBe(true)
    expect(dark.contrast, 'dark ink vs dusk basemap').toBeGreaterThanOrEqual(4.5)
  })
})

// Station d-pad (replaces the directional swipe hint): arms point the
// direction of TRAVEL and name the destination, so eastbound reads as a
// right-pointing arrow regardless of the inverted pan gesture.
test.describe('Station d-pad', () => {
  test('Judkins Park shows Mercer Island east and Intl District west', async ({ page }) => {
    await page.goto('/2/54?hints')
    await page.waitForSelector('.dpad-arm', { timeout: 20000 })
    const right = page.locator('[data-dpad-direction="right"]')
    const left = page.locator('[data-dpad-direction="left"]')
    await expect(right).toContainText('Mercer Island')
    await expect(left).toContainText('International District')
    expect(await page.locator('.dpad-arm').count()).toBe(2)

    // Arms render on the side they point: east arm right of the pill,
    // west arm left of it.
    const pill = await page.locator('.station-pill').first().boundingBox()
    const rightBox = await right.boundingBox()
    const leftBox = await left.boundingBox()
    expect(rightBox.x).toBeGreaterThan(pill.x + pill.width - 1)
    expect(leftBox.x + leftBox.width).toBeLessThan(pill.x + 1)
  })

  test('the junction shows three arms with a divergence roundel', async ({ page }) => {
    // Intl District via Line 1: the east arm rides Line 2.
    await page.goto('/1/53?hints')
    await page.waitForSelector('.dpad-arm', { timeout: 20000 })
    expect(await page.locator('.dpad-arm').count()).toBe(3)
    const east = page.locator('[data-dpad-direction="right"]')
    await expect(east).toContainText('Judkins Park')
    await expect(east.locator('.pill-badge-line-circle')).toHaveText('2')
  })

  test('the d-pad dismisses with the hints', async ({ page }) => {
    await page.goto('/2/54?hints')
    await page.waitForSelector('.dpad-arm', { timeout: 20000 })
    await page.waitForTimeout(400)
    await page.locator('.mapboxgl-canvas').click({ position: { x: 200, y: 200 } })
    await expect(page.locator('.dpad-arm')).toHaveCount(0, { timeout: 3000 })
  })
})
