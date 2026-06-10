import { describe, it, expect } from 'vitest'
import tagCategories from '../../public/pois/tag-categories.json'
import { MAIN_POI_CATEGORIES } from '../constants'
import {
  BENCHMARKS,
  PARKS_BENCHMARK_COLOR,
  contrastRatio,
  dimmedPillBg,
  enabledPillText,
  dimmedPillText,
  ensureContrast,
  compositeOver,
  mixColors,
} from '../pillColors'

// Audit for issue #47: every category chip color, in light and dark mode
// and in both pill states, must read at least as well as the parks green
// benchmark once the adaptive text rules are applied. The palette under
// audit is the live one — tag-categories.json (chip coloring source) plus
// the spotlight pill colors from constants.js — so a palette change that
// regresses below the benchmark fails CI here.

// Slightly looser than the module's internal 0.05 slack so a color the
// rules deliberately leave untouched never trips the floor by rounding.
const EPS = 0.06

const PALETTE = [
  ...Object.entries(tagCategories.categories).map(([id, c]) => ({ id, color: c.color })),
  ...MAIN_POI_CATEGORIES.map(c => ({ id: `spotlight:${c.id}`, color: c.color })),
]

describe('color math', () => {
  it('computes the known white-on-parks-green ratio (~2.87)', () => {
    expect(contrastRatio('#ffffff', PARKS_BENCHMARK_COLOR)).toBeCloseTo(2.87, 1)
  })

  it('contrast is symmetric and floors at 1', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#abc', '#abc')).toBe(1)
  })

  it('compositeOver blends toward the backdrop', () => {
    expect(compositeOver('#000000', 0, '#ffffff')).toBe('#ffffff')
    expect(compositeOver('#000000', 1, '#ffffff')).toBe('#000000')
  })

  it('ensureContrast leaves passing colors untouched', () => {
    expect(ensureContrast('#000000', '#ffffff', 4.5, '#000000')).toBe('#000000')
  })

  it('ensureContrast nudges failing colors toward the mix target', () => {
    const fixed = ensureContrast('#777777', '#888888', 3, '#ffffff')
    expect(contrastRatio(fixed, '#888888')).toBeGreaterThanOrEqual(3 - EPS)
  })

  it('mixColors endpoints', () => {
    expect(mixColors('#112233', '#ffffff', 0)).toBe('#112233')
    expect(mixColors('#112233', '#ffffff', 1)).toBe('#ffffff')
  })
})

describe(`pill visibility audit — every category >= parks benchmark (enabled ${BENCHMARKS.enabled.toFixed(2)}, dimmed light ${BENCHMARKS.dimmedLight.toFixed(2)}, dimmed dark ${BENCHMARKS.dimmedDark.toFixed(2)})`, () => {
  it('audits a non-trivial palette', () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(10)
  })

  it.each(PALETTE)('enabled pill text on $id ($color)', ({ color }) => {
    const text = enabledPillText(color)
    expect(contrastRatio(text, color)).toBeGreaterThanOrEqual(BENCHMARKS.enabled - EPS)
  })

  it.each(PALETTE)('dimmed pill text on $id ($color), light mode', ({ color }) => {
    const text = dimmedPillText(color, false)
    expect(contrastRatio(text, dimmedPillBg(color, false))).toBeGreaterThanOrEqual(BENCHMARKS.dimmedLight - EPS)
  })

  it.each(PALETTE)('dimmed pill text on $id ($color), dark mode', ({ color }) => {
    const text = dimmedPillText(color, true)
    expect(contrastRatio(text, dimmedPillBg(color, true))).toBeGreaterThanOrEqual(BENCHMARKS.dimmedDark - EPS)
  })
})

describe('house-style guardrails', () => {
  it('the parks benchmark itself keeps white signage text and raw dimmed color', () => {
    expect(enabledPillText(PARKS_BENCHMARK_COLOR)).toBe('#ffffff')
    expect(dimmedPillText(PARKS_BENCHMARK_COLOR, false)).toBe(PARKS_BENCHMARK_COLOR)
    expect(dimmedPillText(PARKS_BENCHMARK_COLOR, true)).toBe(PARKS_BENCHMARK_COLOR)
  })

  it('cuisine orange (the dining color) keeps white text', () => {
    expect(enabledPillText('#E67E22')).toBe('#ffffff')
  })

  it('light colors that undershoot the benchmark flip to dark text', () => {
    // meal #F39C12, sport #2ECC71, shop #1ABC9C all read worse than the
    // benchmark with white text (2.19 / 2.10 / 2.41 vs 2.87).
    for (const color of ['#F39C12', '#2ECC71', '#1ABC9C']) {
      expect(enabledPillText(color)).not.toBe('#ffffff')
    }
  })

  it('near-invisible dark-mode dimmed colors get lightened (vibe was 1.24)', () => {
    const fixed = dimmedPillText('#34495E', true)
    expect(fixed).not.toBe('#34495E')
    expect(contrastRatio(fixed, dimmedPillBg('#34495E', true))).toBeGreaterThanOrEqual(BENCHMARKS.dimmedDark - EPS)
  })
})
