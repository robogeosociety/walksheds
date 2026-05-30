// Four hints with hand-drawn ink arrows point at the legend, the search
// input, the category pills, and the attribute-filter checkbox list.
// The overlay itself is pointer-events: none; clicks anywhere on the
// page dismiss it via a document-level listener in Walksheds.jsx.
// The filter hint renders dimmed when no attribute filters are active
// (so the user still learns where filters will live), and switches to
// full opacity + "uncheck to drop" copy once a filter exists.

// Hand-drawn SVG arrows. The wobbly bezier curves and rounded line caps
// mirror the imperfect strokes of the Architects Daughter font; sized to
// match the cap-height of 18-19px text so each arrow reads as part of
// the sentence flow.

function ArrowRight({ flip = false }) {
  return (
    <svg
      className={`hint-arrow hint-arrow-right${flip ? ' flip' : ''}`}
      viewBox="0 0 44 18"
      width="44"
      height="18"
      aria-hidden="true"
    >
      <path
        d="M 2 9.5 C 8 8.2, 16 10.6, 24 9 S 34 9.8, 40 9.2"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 33 3.5 L 40.5 9.2 L 33 14.8"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowDown({ flip = false }) {
  return (
    <svg
      className={`hint-arrow hint-arrow-down${flip ? ' flip' : ''}`}
      viewBox="0 0 22 40"
      width="22"
      height="40"
      aria-hidden="true"
    >
      <path
        d="M 11.5 2 C 9.8 9, 12.2 16, 10.6 23 S 12.4 32, 11 37.5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 5.2 30 L 11 38 L 16.8 30"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

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

// Draw the swipe gesture's finger motion. Horizontal swipes reuse the wide
// ArrowRight glyph (flipped for "left"); vertical swipes reuse the tall
// ArrowDown glyph (flipped for "up"). Flipping is a 180° rotation, so the
// SVG's layout box is unchanged and the arrow still flows inline with text.
function SwipeArrow({ direction }) {
  if (direction === 'left' || direction === 'right') {
    return <ArrowRight flip={direction === 'left'} />
  }
  return <ArrowDown flip={direction === 'up'} />
}

export default function HintOverlay({ legendPosition, legendCollapsed, hasActiveFilters, swipeHint }) {
  const legendClass = [
    'hint',
    'hint-legend',
    legendPosition === 'bottom-right' ? 'bottom-right' : 'bottom-left',
    legendCollapsed ? 'collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="hint-overlay" role="presentation" aria-hidden="true">
      <div className={legendClass}>
        <span className="hint-label">
          legend &mdash; walksheds, units, dark mode &amp; these hints
          <ArrowDown />
        </span>
      </div>

      <div className="hint hint-search">
        <span className="hint-label">
          search any place or feature
          <ArrowRight />
        </span>
      </div>

      <div className="hint hint-pills">
        <span className="hint-label">
          tap a pill to add a place type
          <ArrowRight />
        </span>
      </div>

      <div className={`hint hint-filters${hasActiveFilters ? '' : ' dimmed'}`}>
        <span className="hint-label">
          {hasActiveFilters
            ? 'uncheck to drop an attribute filter'
            : "filter by attribute — add tags from a chip's list"}
          <ArrowRight />
        </span>
      </div>

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
