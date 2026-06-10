import { test, expect } from '@playwright/test'

// Pill visibility audit (issue #47): read the *rendered* category chips'
// computed colors in light and dark mode and check the text/background
// contrast of every pill against the parks-green benchmark — the floors
// below are what #27AE60 achieves with plain white-on-color (enabled)
// and color-on-tint (dimmed) rendering, mirroring src/pillColors.js
// (the exhaustive palette audit lives in __tests__/pillVisibility.test.js;
// this spec guards the real DOM rendering path).

const FLOORS = {
  light: { enabled: 2.87, dimmed: 2.0 },
  dark: { enabled: 2.87, dimmed: 3.01 },
}
const TOLERANCE = 0.08

// Approximate Mapbox Standard land colors behind translucent pill tints
// (kept in sync with LIGHT_MAP_BG / DARK_MAP_BG in src/pillColors.js).
const MAP_BG = { light: [242, 239, 233], dark: [52, 52, 63] }

function auditPillsInPage(mapBg) {
  const parseColor = (str) => {
    const m = str.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1].split(',').map(Number)
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 }
  }
  const composite = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha))
  const luminance = ([r, g, b]) => {
    const ch = (v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }
  const contrast = (a, b) => {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  const out = []
  for (const el of document.querySelectorAll('.poi-cat-pill')) {
    if (el.classList.contains('poi-cat-pill-clear')) continue
    const cs = getComputedStyle(el)
    const text = parseColor(cs.color)
    const bg = parseColor(cs.backgroundColor)
    if (!text || !bg) continue
    const effectiveBg = composite(bg.rgb, bg.alpha, mapBg)
    out.push({
      label: el.textContent.trim().replace(/\d+$/, ''),
      state: el.classList.contains('enabled') ? 'enabled' : 'dimmed',
      contrast: contrast(composite(text.rgb, text.alpha, effectiveBg), effectiveBg),
    })
  }
  return out
}

test.describe('Category pill visibility audit', () => {
  test('every rendered pill meets the parks benchmark in light and dark mode', async ({ page }, testInfo) => {
    await page.goto('/')
    await page.waitForSelector('.poi-cat-pill', { timeout: 15000 })

    const failures = []
    const report = []

    for (const mode of ['light', 'dark']) {
      if (mode === 'dark') {
        await page.keyboard.press('d')
        await page.waitForSelector('.app.dark', { timeout: 5000 })
      }
      const pills = await page.evaluate(auditPillsInPage, MAP_BG[mode])
      expect(pills.length, `${mode} mode renders pills to audit`).toBeGreaterThan(0)
      for (const pill of pills) {
        const floor = FLOORS[mode][pill.state]
        const pass = pill.contrast >= floor - TOLERANCE
        report.push(
          `${mode.padEnd(5)} ${pill.state.padEnd(7)} ${pill.label.padEnd(16)} ${pill.contrast.toFixed(2)} (floor ${floor}) ${pass ? 'ok' : 'FAIL'}`,
        )
        if (!pass) failures.push(`${mode}/${pill.state} "${pill.label}": ${pill.contrast.toFixed(2)} < ${floor}`)
      }
    }

    await testInfo.attach('pill-contrast-report', {
      body: report.join('\n'),
      contentType: 'text/plain',
    })
    expect(failures, `pills below the parks visibility benchmark:\n${failures.join('\n')}`).toEqual([])
  })
})
