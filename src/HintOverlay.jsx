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

function ArrowRight() {
  return (
    <svg
      className="hint-arrow hint-arrow-right"
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

function ArrowDown() {
  return (
    <svg
      className="hint-arrow hint-arrow-down"
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

export default function HintOverlay({ legendPosition, legendCollapsed, hasActiveFilters }) {
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
    </div>
  )
}
