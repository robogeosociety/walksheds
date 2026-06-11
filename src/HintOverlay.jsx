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

import { useState, useEffect } from 'react'
import { HINT_DEFS, measureHints, arrowPaths } from './hintLayout'

const MEASURE_INTERVAL_MS = 250

// A touch swipe is the inverse of the travel direction — you drag the world
// the opposite way, like panning a map. This mirrors the gesture mapping in
// useNavigation.js (swipe up → ArrowDown, swipe down → ArrowUp, swipe left →
// ArrowRight, swipe right → ArrowLeft), so the word + arrow the hint shows
// match the finger motion that actually reaches the next station.
const SWIPE_FOR_ARROW = {
  ArrowUp: 'down',
  ArrowDown: 'up',
  ArrowLeft: 'right',
  ArrowRight: 'left',
}

// Static glyphs for the swipe hint: its arrow shows the finger motion of
// a gesture, not the location of a control, so it stays inline with the
// text rather than being generated from a measurement.
function GestureArrowRight({ flip = false }) {
  return (
    <svg className={`hint-arrow hint-arrow-right${flip ? ' flip' : ''}`} viewBox="0 0 44 18" width="44" height="18" aria-hidden="true">
      <path d="M 2 9.5 C 8 8.2, 16 10.6, 24 9 S 34 9.8, 40 9.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 33 3.5 L 40.5 9.2 L 33 14.8" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GestureArrowDown({ flip = false }) {
  return (
    <svg className={`hint-arrow hint-arrow-down${flip ? ' flip' : ''}`} viewBox="0 0 22 40" width="22" height="40" aria-hidden="true">
      <path d="M 11.5 2 C 9.8 9, 12.2 16, 10.6 23 S 12.4 32, 11 37.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 5.2 30 L 11 38 L 16.8 30" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SwipeArrow({ direction }) {
  if (direction === 'left' || direction === 'right') {
    return <GestureArrowRight flip={direction === 'left'} />
  }
  return <GestureArrowDown flip={direction === 'up'} />
}

const COPY = {}
for (const def of HINT_DEFS) COPY[def.id] = { copy: def.copy, fallbackCopy: def.fallbackCopy }

export default function HintOverlay({ swipeHint }) {
  const [layout, setLayout] = useState([])
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  // Re-measure on an interval (and on resize) while the overlay is up:
  // the targets move with legend collapse, pill wrapping, and the filter
  // list mounting, and CSS transitions settle between renders. The
  // overlay is transient onboarding UI, so the poll is short-lived.
  useEffect(() => {
    let last = ''
    const update = () => {
      const next = measureHints()
      const vp = { width: window.innerWidth, height: window.innerHeight }
      const sig = JSON.stringify([next, vp])
      if (sig === last) return
      last = sig
      setLayout(next)
      setViewport(vp)
    }
    update()
    window.addEventListener('resize', update)
    const interval = setInterval(update, MEASURE_INTERVAL_MS)
    return () => {
      window.removeEventListener('resize', update)
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="hint-overlay" role="presentation" aria-hidden="true">
      {viewport.width > 0 && (
        <svg className="hint-arrows" width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
          {layout.map((h, i) => {
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

      {layout.map(h => {
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

      {swipeHint && (
        <div className="hint hint-swipe">
          <span className="hint-label">
            swipe {SWIPE_FOR_ARROW[swipeHint.arrowKey]} to ride to {swipeHint.label}
            <SwipeArrow direction={SWIPE_FOR_ARROW[swipeHint.arrowKey]} />
          </span>
        </div>
      )}
    </div>
  )
}
