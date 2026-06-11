// Hint-overlay layout (issue follow-up to #45): every hint is anchored to
// the live DOM rect of the control it describes, and its arrow is
// regenerated each measurement to point from the label to that control's
// real location. No hard-coded offsets — if the legend collapses, the
// pill row wraps, or the filter list appears, the labels and arrows
// follow. computeHintLayout is pure so the arrow-hits-target guarantee
// is unit-tested; measureHints binds it to the document.

// Gap between the label edge and the arrow start, and between the arrow
// tip and the target edge.
const ARROW_REACH = 42
const TIP_GAP = 6
const EDGE_PAD = 8

export const HINT_DEFS = [
  {
    id: 'legend',
    selector: '.line-legend',
    side: 'above',
    copy: 'legend — walksheds, units, dark mode & these hints',
  },
  {
    id: 'search',
    selector: '.poi-search-input-row',
    side: 'left',
    copy: 'search places, cuisines, or stations',
  },
  {
    id: 'pills',
    selector: '.poi-cat-pills',
    side: 'left',
    copy: 'pills are place types — tap one to list its places',
  },
  {
    id: 'filters',
    selector: '.poi-filter-list',
    fallback: '.poi-cat-pills',
    fallbackAnchor: 'bottom-left',
    side: 'left',
    copy: 'uncheck to drop an attribute filter',
    fallbackCopy: 'search a quality like patio — filters land here',
  },
]

/**
 * Pure layout: given measured target rects and the viewport, place each
 * label beside its control and aim the arrow at the control's edge.
 *
 * targets: { [id]: { rect: {left,top,right,bottom,width,height}, usedFallback } }
 * Returns [{ id, usedFallback, label: {left,top,maxWidth,textAlign}, arrow: {x1,y1,x2,y2} }]
 * Labels are vertically centered on `label.top` via CSS translateY(-50%).
 */
export function computeHintLayout(targets, viewport) {
  const out = []
  for (const def of HINT_DEFS) {
    const t = targets[def.id]
    if (!t || !t.rect || t.rect.width === 0) continue
    const { rect, usedFallback } = t
    const anchor = usedFallback ? def.fallbackAnchor : def.anchor

    if (def.side === 'above') {
      // Label above the control, arrow pointing down at its top edge.
      const endX = Math.min(rect.left + 56, rect.left + rect.width / 2)
      const endY = rect.top - TIP_GAP
      const startY = endY - ARROW_REACH
      const maxWidth = Math.min(280, viewport.width - 2 * EDGE_PAD)
      const left = Math.max(EDGE_PAD, Math.min(rect.left, viewport.width - maxWidth - EDGE_PAD))
      out.push({
        id: def.id,
        usedFallback: !!usedFallback,
        label: { left, top: startY - 8, maxWidth, textAlign: 'left', vAlign: 'bottom' },
        arrow: { x1: Math.max(left + 16, endX - 14), y1: startY, x2: endX, y2: endY },
      })
      continue
    }

    // side 'left': label sits left of the control, arrow pointing right at
    // its left edge (or its bottom-left corner for the fallback anchor,
    // marking where the control's content will appear).
    const endX = rect.left - TIP_GAP
    const endY = anchor === 'bottom-left'
      ? rect.bottom + 10
      : rect.top + Math.min(rect.height / 2, 24)
    const labelRight = rect.left - ARROW_REACH
    const maxWidth = Math.max(96, Math.min(300, labelRight - 2 * EDGE_PAD))
    const left = Math.max(EDGE_PAD, labelRight - maxWidth)
    out.push({
      id: def.id,
      usedFallback: !!usedFallback,
      label: { left, top: endY, maxWidth, textAlign: 'right', vAlign: 'center' },
      arrow: { x1: labelRight + 4, y1: endY, x2: endX, y2: endY },
    })
  }
  return separateLabels(out)
}

// Wrapped labels are taller than the row pitch of the controls they
// describe, so vertically-centered neighbors can collide. Push each
// left-side label down until it clears the previous one; the arrow start
// follows the label while the tip stays on the target, so a shifted hint
// just gets a slanted arrow.
const MIN_LABEL_PITCH = 52

function separateLabels(hints) {
  let lastY = -Infinity
  for (const h of hints) {
    if (h.label.vAlign !== 'center') continue
    if (h.label.top - lastY < MIN_LABEL_PITCH) {
      h.label.top = lastY + MIN_LABEL_PITCH
      h.arrow.x1 = h.arrow.x1 - 2
      h.arrow.y1 = h.label.top
    }
    lastY = h.label.top
  }
  return hints
}

/**
 * A hand-drawn arrow as SVG path data: a gently wobbled cubic from
 * (x1,y1) to (x2,y2) plus a two-stroke head, matching the Architects
 * Daughter ink of the labels. The wobble is deterministic (keyed on the
 * hint index) so arrows don't shimmer between re-measurements.
 */
export function arrowPaths({ x1, y1, x2, y2 }, seed = 0) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const w = Math.min(7, len * 0.18) * (seed % 2 === 0 ? 1 : -1)
  const c1x = x1 + dx * 0.32 + nx * w
  const c1y = y1 + dy * 0.32 + ny * w
  const c2x = x1 + dx * 0.68 - nx * w
  const c2y = y1 + dy * 0.68 - ny * w
  const shaft = `M ${r(x1)} ${r(y1)} C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(x2)} ${r(y2)}`

  // Head: two strokes splayed back from the tip along the incoming angle.
  const theta = Math.atan2(y2 - c2y, x2 - c2x)
  const headLen = 8
  const spread = 2.6 // radians off the reverse direction (~150 degrees)
  const hx1 = x2 + headLen * Math.cos(theta + spread)
  const hy1 = y2 + headLen * Math.sin(theta + spread)
  const hx2 = x2 + headLen * Math.cos(theta - spread)
  const hy2 = y2 + headLen * Math.sin(theta - spread)
  const head = `M ${r(hx1)} ${r(hy1)} L ${r(x2)} ${r(y2)} L ${r(hx2)} ${r(hy2)}`
  return { shaft, head }
}

function r(n) {
  return Math.round(n * 10) / 10
}

/**
 * DOM binding: measure each hint's target (falling back where defined)
 * and run the pure layout. Returns [] until the controls exist.
 */
export function measureHints(doc = document, win = window) {
  const targets = {}
  for (const def of HINT_DEFS) {
    let el = doc.querySelector(def.selector)
    let usedFallback = false
    if (!el && def.fallback) {
      el = doc.querySelector(def.fallback)
      usedFallback = true
    }
    if (el) targets[def.id] = { rect: el.getBoundingClientRect(), usedFallback }
  }
  return computeHintLayout(targets, { width: win.innerWidth, height: win.innerHeight })
}
