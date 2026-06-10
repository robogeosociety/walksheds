import { describe, it, expect } from 'vitest'
import { computeHintLayout, arrowPaths, measureHints, HINT_DEFS } from '../hintLayout'

const VIEWPORT = { width: 1280, height: 800 }

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

// A typical desktop layout: search column top-right, legend bottom-left.
const TARGETS = {
  legend: { rect: rect(16, 470, 180, 280) },
  search: { rect: rect(1044, 16, 220, 36) },
  pills: { rect: rect(1044, 60, 220, 54) },
  filters: { rect: rect(1044, 122, 220, 48) },
}

function within(value, lo, hi) {
  return value >= lo && value <= hi
}

// Inflate a rect slightly: the arrow tip stops a few px short of the
// control edge (or, for the bottom-left fallback anchor, just below it).
function tipHitsTarget(arrow, r, pad = 12) {
  return within(arrow.x2, r.left - pad, r.right + pad) && within(arrow.y2, r.top - pad, r.bottom + pad)
}

describe('computeHintLayout — arrows point at their targets', () => {
  const layout = computeHintLayout(TARGETS, VIEWPORT)

  it('lays out every defined hint when all targets exist', () => {
    expect(layout.map(h => h.id).sort()).toEqual(['filters', 'legend', 'pills', 'search'])
  })

  it.each(['legend', 'search', 'pills', 'filters'])('the %s arrow tip lands on its control', (id) => {
    const h = layout.find(l => l.id === id)
    expect(tipHitsTarget(h.arrow, TARGETS[id].rect)).toBe(true)
  })

  it('left-side labels sit fully left of their control, inside the viewport', () => {
    for (const id of ['search', 'pills', 'filters']) {
      const h = layout.find(l => l.id === id)
      expect(h.label.left).toBeGreaterThanOrEqual(8)
      expect(h.label.left + h.label.maxWidth).toBeLessThan(TARGETS[id].rect.left)
    }
  })

  it('the legend label sits above the legend with a downward arrow', () => {
    const h = layout.find(l => l.id === 'legend')
    expect(h.arrow.y1).toBeLessThan(h.arrow.y2)
    expect(h.arrow.y2).toBeLessThan(TARGETS.legend.rect.top)
    expect(h.arrow.y2).toBeGreaterThan(TARGETS.legend.rect.top - 12)
  })

  it('skips hints whose target is missing or unrendered', () => {
    const partial = computeHintLayout({ legend: TARGETS.legend, search: { rect: rect(0, 0, 0, 0) } }, VIEWPORT)
    expect(partial.map(h => h.id)).toEqual(['legend'])
  })

  it('tracks a moved control: collapsed legend at bottom-center', () => {
    const collapsed = computeHintLayout(
      { legend: { rect: rect(480, 752, 320, 36) } },
      VIEWPORT,
    )
    const h = collapsed[0]
    expect(tipHitsTarget(h.arrow, rect(480, 752, 320, 36))).toBe(true)
    expect(h.arrow.y2).toBeLessThan(752)
  })

  it('filter fallback anchors to the bottom edge of the pill row', () => {
    const fb = computeHintLayout(
      { filters: { rect: TARGETS.pills.rect, usedFallback: true } },
      VIEWPORT,
    )
    const h = fb[0]
    expect(h.usedFallback).toBe(true)
    expect(h.arrow.y2).toBeGreaterThan(TARGETS.pills.rect.bottom)
    expect(h.arrow.y2).toBeLessThan(TARGETS.pills.rect.bottom + 16)
  })

  it('separates stacked labels so wrapped text cannot collide, keeping tips on target', () => {
    // Search, pills, and the filters fallback stack closely down the
    // right column; centered multi-line labels would overlap without the
    // minimum pitch.
    const tight = computeHintLayout({
      search: { rect: rect(1044, 16, 220, 36) },
      pills: { rect: rect(1044, 56, 220, 30) },
      filters: { rect: rect(1044, 56, 220, 30), usedFallback: true },
    }, VIEWPORT)
    const ys = tight.map(h => h.label.top)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(52)
    }
    // Shifted labels keep their arrows on the control: tips unchanged.
    expect(tipHitsTarget(tight[1].arrow, rect(1044, 56, 220, 30))).toBe(true)
    expect(tight[2].arrow.y2).toBeGreaterThan(86)
  })

  it('clamps labels on narrow phone viewports', () => {
    const phone = { width: 375, height: 667 }
    const narrow = computeHintLayout(
      { search: { rect: rect(187, 12, 180, 34) } },
      phone,
    )
    const h = narrow[0]
    expect(h.label.left).toBeGreaterThanOrEqual(8)
    expect(h.label.maxWidth).toBeGreaterThanOrEqual(96)
    expect(tipHitsTarget(h.arrow, rect(187, 12, 180, 34))).toBe(true)
  })
})

describe('arrowPaths', () => {
  it('shaft runs from start to tip; head meets the tip', () => {
    const { shaft, head } = arrowPaths({ x1: 10, y1: 20, x2: 110, y2: 60 })
    expect(shaft.startsWith('M 10 20 C')).toBe(true)
    expect(shaft.endsWith('110 60')).toBe(true)
    expect(head).toContain('L 110 60')
  })

  it('wobble alternates by seed but endpoints stay fixed', () => {
    const a = arrowPaths({ x1: 0, y1: 0, x2: 100, y2: 0 }, 0)
    const b = arrowPaths({ x1: 0, y1: 0, x2: 100, y2: 0 }, 1)
    expect(a.shaft).not.toBe(b.shaft)
    expect(a.shaft.endsWith('100 0')).toBe(true)
    expect(b.shaft.endsWith('100 0')).toBe(true)
  })
})

describe('measureHints — DOM binding and fallback', () => {
  function fakeDoc(selectors) {
    return {
      querySelector: (sel) => selectors[sel]
        ? { getBoundingClientRect: () => selectors[sel] }
        : null,
    }
  }
  const win = { innerWidth: 1280, innerHeight: 800 }

  it('uses the filter list when present', () => {
    const doc = fakeDoc({
      '.poi-filter-list': rect(1044, 122, 220, 48),
      '.poi-cat-pills': rect(1044, 60, 220, 54),
    })
    const out = measureHints(doc, win)
    const filters = out.find(h => h.id === 'filters')
    expect(filters.usedFallback).toBe(false)
  })

  it('falls back to the pill row when no filter list exists', () => {
    const doc = fakeDoc({ '.poi-cat-pills': rect(1044, 60, 220, 54) })
    const out = measureHints(doc, win)
    const filters = out.find(h => h.id === 'filters')
    expect(filters.usedFallback).toBe(true)
    const pills = out.find(h => h.id === 'pills')
    expect(pills.usedFallback).toBe(false)
  })

  it('every hint def carries first-time-user copy (and fallback copy where defined)', () => {
    for (const def of HINT_DEFS) {
      expect(def.copy.length).toBeGreaterThan(10)
      if (def.fallback) expect(def.fallbackCopy.length).toBeGreaterThan(10)
    }
  })
})
