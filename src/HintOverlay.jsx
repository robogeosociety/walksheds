// Onboarding hints, anchored to the real controls they describe. Each
// hint label is positioned next to its target's live DOM rect and a
// hand-drawn SVG arrow is regenerated to point at the control itself
// (see hintLayout.js) — collapsing the legend, wrapping the pill row, or
// the filter list appearing all just move the hints along. The overlay
// is pointer-events: none; clicks anywhere dismiss it via a
// document-level listener in Walksheds.jsx.
//
// The filter hint anchors to the checkbox list when one exists ("uncheck
// to drop"); with no active filters it dims, anchors to the pill row's
// bottom edge, and tells the user how filters get added and where they
// will appear.
//
// Travel directions are no longer taught here: the station d-pad
// (StationPill) shows an arm per navigable direction, pointing the way
// you travel and naming the destination. This overlay keeps only a
// gesture-neutral caption — naming a swipe direction inverts against
// the travel direction (you drag the world the other way) and read
// backwards ("swipe left to ride east").

import { useState, useEffect, useRef } from 'react'
import { HINT_DEFS, measureHints, arrowPaths, resolveAgainstObstacles } from './hintLayout'

const MEASURE_INTERVAL_MS = 250
const EDGE_PAD = 8
const NUDGE_RANGE = 100 // max px an anchored hint slides to dodge an obstacle
const CLEARANCE = 7 // gap kept between a hint label and an obstacle

const COPY = {}
for (const def of HINT_DEFS) COPY[def.id] = { copy: def.copy, fallbackCopy: def.fallbackCopy }

// Obstacle box inflated by CLEARANCE so resolved labels keep a visible
// gap from the d-pad arms / caption rather than merely touching them.
const obstacleOf = (r) => ({
  left: r.left - CLEARANCE, top: r.top - CLEARANCE,
  right: r.right + CLEARANCE, bottom: r.bottom + CLEARANCE,
})
const boxOf = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

// Conservative label-size estimate, used only until a hint has rendered
// once and its real size is cached. Keeps every hint in the resolution
// each frame (a hint skipped because its DOM node wasn't queryable yet
// would render at its raw, possibly-overlapping anchor).
function estimateSize(id, usedFallback, maxWidth, vpWidth) {
  const text = usedFallback ? (COPY[id].fallbackCopy || COPY[id].copy) : COPY[id].copy
  const fontPx = vpWidth <= 540 ? 14 : vpWidth <= 1024 ? 16 : 18
  const full = text.length * fontPx * 0.55
  const lines = Math.max(1, Math.ceil(full / maxWidth))
  return { w: Math.min(maxWidth, Math.max(40, full)), h: Math.round(lines * fontPx * 1.4) + 4 }
}

// Safe-area box for an anchored hint: its CURRENT computed anchor
// (label.left/top) sized by the label's real rect (cached once rendered,
// estimated before that). Always returns an item so no hint escapes the
// collision pass.
function hintItem(h, sizes, viewport, legendRect) {
  const { w, h: ht } = sizes[h.id] || estimateSize(h.id, h.usedFallback, h.label.maxWidth, viewport.width)
  const box = h.label.vAlign === 'bottom'
    ? { left: h.label.left, right: h.label.left + w, top: h.label.top - ht, bottom: h.label.top }
    : { left: h.label.left, right: h.label.left + w, top: h.label.top - ht / 2, bottom: h.label.top + ht / 2 }
  // The legend hint sits above its card and may slide down toward it
  // (shorter arrow) but must not cover the card; others slide freely
  // within the viewport.
  let maxDy = Math.min(NUDGE_RANGE, viewport.height - EDGE_PAD - box.bottom)
  if (h.id === 'legend' && legendRect) maxDy = Math.min(maxDy, Math.max(0, legendRect.top - 6 - box.bottom))
  const minDy = Math.max(-NUDGE_RANGE, EDGE_PAD - box.top)
  return { id: h.id, box, minDy, maxDy }
}

export default function HintOverlay() {
  const [layout, setLayout] = useState([])
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [swipeHidden, setSwipeHidden] = useState(false)
  // Real label sizes, cached once each hint has rendered so a frame where
  // a node is momentarily unqueryable still resolves it.
  const sizesRef = useRef({})

  // Re-measure on an interval (and on resize) while the overlay is up:
  // the targets move with legend collapse, pill wrapping, the filter
  // list mounting, and the station d-pad re-projecting as the map frames.
  // Each tick re-anchors the hints to their controls, then resolves their
  // safe-areas against the d-pad arms + swipe caption so nothing overlaps.
  // The overlay is transient onboarding UI, so the poll is short-lived.
  useEffect(() => {
    let last = ''
    const update = () => {
      const base = measureHints()
      const vp = { width: window.innerWidth, height: window.innerHeight }

      // Immovable obstacles: the d-pad arm labels (direction is fixed)
      // and the screen-pinned swipe caption.
      const obstacles = [...document.querySelectorAll('.dpad-label')].map(el => obstacleOf(el.getBoundingClientRect()))
      const legendRect = document.querySelector('.line-legend')?.getBoundingClientRect()

      // Refresh the size cache from any rendered labels this frame.
      const sizes = sizesRef.current
      for (const h of base) {
        const el = document.querySelector(`.hint-${h.id} .hint-label`)
        if (el) { const r = el.getBoundingClientRect(); if (r.width && r.height) sizes[h.id] = { w: r.width, h: r.height } }
      }
      const items = base.map(h => hintItem(h, sizes, vp, legendRect))
      // The swipe caption is fixed (no slide) — it only hides if a d-pad
      // arm lands on it. Resolved last so it yields to everything.
      const swipeEl = document.querySelector('.hint-swipe .hint-label')
      if (swipeEl) {
        items.push({ id: 'swipe', box: boxOf(swipeEl.getBoundingClientRect()), minDy: 0, maxDy: 0 })
      }

      const res = resolveAgainstObstacles(items, obstacles)
      const resolved = base.map(h => {
        const r = res[h.id]
        if (!r) return h
        if (r.hidden) return { ...h, hidden: true }
        if (!r.dy) return h
        return { ...h, label: { ...h.label, top: h.label.top + r.dy }, arrow: { ...h.arrow, y1: h.arrow.y1 + r.dy } }
      })
      const swipeOff = res.swipe?.hidden ?? false

      const sig = JSON.stringify([resolved, vp, swipeOff])
      if (sig === last) return
      last = sig
      setLayout(resolved)
      setViewport(vp)
      setSwipeHidden(swipeOff)
    }
    update()
    // Settle within a couple of frames once the labels first render
    // (their measured sizes feed the resolver), not on the 250ms tick.
    const raf = requestAnimationFrame(() => requestAnimationFrame(update))
    window.addEventListener('resize', update)
    const interval = setInterval(update, MEASURE_INTERVAL_MS)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="hint-overlay" role="presentation" aria-hidden="true">
      {viewport.width > 0 && (
        <svg className="hint-arrows" width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
          {layout.filter(h => !h.hidden).map((h, i) => {
            const { shaft, head } = arrowPaths(h.arrow, i)
            const dimmed = h.id === 'filters' && h.usedFallback
            return (
              <g key={h.id} className={dimmed ? 'dimmed' : ''} data-hint-arrow={h.id} data-x2={h.arrow.x2} data-y2={h.arrow.y2}>
                <path className="hint-arrow-halo" d={shaft} />
                <path className="hint-arrow-halo" d={head} />
                <path className="hint-arrow-ink" d={shaft} />
                <path className="hint-arrow-ink" d={head} />
              </g>
            )
          })}
        </svg>
      )}

      {layout.filter(h => !h.hidden).map(h => {
        const dimmed = h.id === 'filters' && h.usedFallback
        const text = h.usedFallback ? (COPY[h.id].fallbackCopy || COPY[h.id].copy) : COPY[h.id].copy
        const style = {
          left: h.label.left,
          top: h.label.top,
          maxWidth: h.label.maxWidth,
          textAlign: h.label.textAlign,
          transform: h.label.vAlign === 'center' ? 'translateY(-50%)' : 'translateY(-100%)',
        }
        return (
          <div key={h.id} className={`hint hint-${h.id}${dimmed ? ' dimmed' : ''}`} style={style} data-hint-for={h.id}>
            <span className="hint-label">{text}</span>
          </div>
        )
      })}

      {/* Rendered even when hidden so its rect is still measurable for the
          next tick's resolution; visibility toggles via the class. */}
      <div className={`hint hint-swipe${swipeHidden ? ' hint-hidden' : ''}`}>
        <span className="hint-label">
          swipe the map or use arrow keys to ride the line
        </span>
      </div>
    </div>
  )
}
