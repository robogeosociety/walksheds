// Category-pill color accessibility (issue #47). The parks green
// (#27AE60) is the visibility benchmark: it reads clearly in both
// themes, so every other category pill must meet or beat the contrast
// it achieves in the same state. Two rendering states matter:
//
//   enabled  — solid category color with overlaid text (theme-independent)
//   dimmed   — category-color text on a 25%-alpha tint of itself over the
//              map (theme-dependent: the tint composites onto the basemap)
//
// Colors that fall short of the benchmark get their text adapted: enabled
// pills flip from white to near-black text (light colors like meal-orange
// and sport-green), dimmed pills mix their text toward black (light
// theme) or white (dark theme) until they clear the bar. The audit in
// __tests__/pillVisibility.test.js runs every palette color through
// these rules; e2e/pill-visibility.spec.js checks the rendered DOM.

// Approximate Mapbox Standard land colors (day / dusk) behind the pills.
export const LIGHT_MAP_BG = '#f2efe9'
export const DARK_MAP_BG = '#34343f'

export const PARKS_BENCHMARK_COLOR = '#27AE60'
export const DARK_TEXT = '#1c2733'
const WHITE = '#ffffff'

// Alpha of the dimmed pill tint: the '40' suffix POISearch appends.
const DIMMED_ALPHA = 0x40 / 0xff

// Slack so colors at or imperceptibly below the benchmark (parks itself;
// cuisine orange at 2.85 vs 2.87) pass without text changes.
const EPS = 0.05

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** fg at `alpha` composited over an opaque bg. */
export function compositeOver(fg, alpha, bg) {
  const f = hexToRgb(fg)
  const g = hexToRgb(bg)
  return rgbToHex(f.map((v, i) => v * alpha + g[i] * (1 - alpha)))
}

/** Linear mix: t=0 returns a, t=1 returns b. */
export function mixColors(a, b, t) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex(ca.map((v, i) => v * (1 - t) + cb[i] * t))
}

/** Background of a dimmed pill: the 25% tint over the basemap. */
export function dimmedPillBg(color, darkMode) {
  return compositeOver(color, DIMMED_ALPHA, darkMode ? DARK_MAP_BG : LIGHT_MAP_BG)
}

// The benchmark contrasts parks-green achieves with the plain rendering
// rules (white text enabled; raw color text dimmed). Computed once at
// module load so the bar moves with the basemap constants.
export const BENCHMARKS = {
  enabled: contrastRatio(WHITE, PARKS_BENCHMARK_COLOR),
  dimmedLight: contrastRatio(PARKS_BENCHMARK_COLOR, dimmedPillBg(PARKS_BENCHMARK_COLOR, false)),
  dimmedDark: contrastRatio(PARKS_BENCHMARK_COLOR, dimmedPillBg(PARKS_BENCHMARK_COLOR, true)),
}

/**
 * Mix `fg` toward `mixTarget` just far enough that it reaches `target`
 * contrast against `bg`; returns `fg` untouched when it already passes.
 */
export function ensureContrast(fg, bg, target, mixTarget) {
  if (contrastRatio(fg, bg) >= target - EPS) return fg
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = mixColors(fg, mixTarget, t)
    if (contrastRatio(candidate, bg) >= target - EPS) return candidate
  }
  return mixTarget
}

/**
 * Text color for an enabled (solid) pill: white — the transit-signage
 * idiom — unless white reads worse than the parks benchmark on this
 * color, in which case near-black.
 */
export function enabledPillText(color) {
  if (contrastRatio(WHITE, color) >= BENCHMARKS.enabled - EPS) return WHITE
  return DARK_TEXT
}

/**
 * Text color for a dimmed pill: the category color itself, nudged toward
 * black (light theme) or white (dark theme) until it clears the parks
 * benchmark against the pill's tinted background.
 */
export function dimmedPillText(color, darkMode) {
  const bg = dimmedPillBg(color, darkMode)
  const target = darkMode ? BENCHMARKS.dimmedDark : BENCHMARKS.dimmedLight
  return ensureContrast(color, bg, target, darkMode ? WHITE : DARK_TEXT)
}
