import { describe, it, expect } from 'vitest'
import { computeHintLayout, arrowPaths, measureHints, resolveAgainstObstacles, rectsOverlap, HINT_DEFS } from '../hintLayout'

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

describe('resolveAgainstObstacles — safe-area collision', () => {
  const box = (left, top, right, bottom) => ({ left, top, right, bottom })
  const apply = (b, dy) => ({ ...b, top: b.top + dy, bottom: b.bottom + dy })

  it('leaves a hint untouched when nothing overlaps it', () => {
    const items = [{ id: 'legend', box: box(8, 493, 288, 529), minDy: -60, maxDy: 60 }]
    const res = resolveAgainstObstacles(items, [box(0, 0, 50, 50)])
    expect(res.legend).toEqual({ dy: 0, hidden: false })
  })

  it('slides a hint down off an overlapping obstacle (the legend vs down-arm case)', () => {
    // Legend hint y[493-529] overlapped by the d-pad down arm y[486-506].
    const items = [{ id: 'legend', box: box(8, 493, 288, 529), minDy: -40, maxDy: 60 }]
    const obstacles = [box(172, 486, 235, 506)]
    const res = resolveAgainstObstacles(items, obstacles)
    expect(res.legend.hidden).toBe(false)
    expect(res.legend.dy).toBeGreaterThan(0)
    // The shifted label clears the obstacle.
    expect(rectsOverlap(apply(items[0].box, res.legend.dy), obstacles[0])).toBe(false)
  })

  it('prefers the smaller shift (up vs down) to clear', () => {
    // Obstacle clips only the top edge: a tiny downward nudge clears it.
    const items = [{ id: 'h', box: box(100, 100, 200, 140), minDy: -100, maxDy: 100 }]
    const res = resolveAgainstObstacles(items, [box(100, 80, 200, 104)])
    expect(res.h.dy).toBeGreaterThan(0)
    expect(res.h.dy).toBeLessThanOrEqual(12)
  })

  it('hides a hint that cannot clear within its bounds', () => {
    // A tall obstacle covers the whole slide range.
    const items = [{ id: 'legend', box: box(8, 490, 288, 526), minDy: -20, maxDy: 20 }]
    const res = resolveAgainstObstacles(items, [box(0, 400, 380, 600)])
    expect(res.legend).toEqual({ dy: 0, hidden: true })
  })

  it('earlier items win the space; later items yield around them', () => {
    // Two stacked hints and an obstacle on the first: the first slides,
    // the second must avoid both the obstacle and the moved first.
    const items = [
      { id: 'a', box: box(0, 100, 100, 130), minDy: -80, maxDy: 80 },
      { id: 'b', box: box(0, 135, 100, 165), minDy: -80, maxDy: 80 },
    ]
    const obstacles = [box(0, 90, 100, 120)]
    const res = resolveAgainstObstacles(items, obstacles)
    const ra = apply(items[0].box, res.a.dy)
    const rb = apply(items[1].box, res.b.dy)
    expect(rectsOverlap(ra, obstacles[0])).toBe(false)
    expect(rectsOverlap(rb, obstacles[0])).toBe(false)
    expect(rectsOverlap(ra, rb)).toBe(false)
  })

  it('a zero-range item (the swipe caption) hides on overlap, stays on clear', () => {
    const pinned = box(98, 668, 293, 704)
    expect(resolveAgainstObstacles([{ id: 'swipe', box: pinned, minDy: 0, maxDy: 0 }], [box(150, 660, 200, 690)]).swipe.hidden).toBe(true)
    expect(resolveAgainstObstacles([{ id: 'swipe', box: pinned, minDy: 0, maxDy: 0 }], [box(0, 0, 50, 50)]).swipe.hidden).toBe(false)
  })
})
