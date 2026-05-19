// Single transparent hint overlay. Three labels with thick arrows point at
// the legend, the place search input, and the filter pills row. The overlay
// itself is pointer-events: none; clicks anywhere on the page dismiss it via
// a document-level listener in Walksheds.jsx.

const ARROW_HEAD = (
  <defs>
    <marker
      id="hint-arrowhead"
      viewBox="0 0 10 10"
      refX="8"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
    >
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
    </marker>
  </defs>
)

export default function HintOverlay({ legendPosition, legendCollapsed }) {
  const legendClass = [
    'hint',
    'hint-legend',
    legendPosition === 'bottom-right' ? 'bottom-right' : 'bottom-left',
    legendCollapsed ? 'collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="hint-overlay" role="presentation" aria-hidden="true">
      <div className={legendClass}>
        <span className="hint-label">legend &mdash; toggle walksheds, dark mode, &amp; these hints</span>
        <svg className="hint-arrow hint-arrow-legend" width="120" height="90" viewBox="0 0 120 90" aria-hidden="true">
          {ARROW_HEAD}
          <path
            d="M 30 5 C 25 30, 35 55, 50 80"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
            markerEnd="url(#hint-arrowhead)"
          />
        </svg>
      </div>

      <div className="hint hint-search">
        <span className="hint-label">search any place by name or category</span>
        <svg className="hint-arrow hint-arrow-search" width="160" height="60" viewBox="0 0 160 60" aria-hidden="true">
          {ARROW_HEAD}
          <path
            d="M 10 40 C 50 20, 100 18, 145 28"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
            markerEnd="url(#hint-arrowhead)"
          />
        </svg>
      </div>

      <div className="hint hint-pills">
        <span className="hint-label">tap a pill to filter what shows up on the map</span>
        <svg className="hint-arrow hint-arrow-pills" width="160" height="60" viewBox="0 0 160 60" aria-hidden="true">
          {ARROW_HEAD}
          <path
            d="M 10 15 C 50 30, 100 35, 145 30"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
            markerEnd="url(#hint-arrowhead)"
          />
        </svg>
      </div>
    </div>
  )
}
