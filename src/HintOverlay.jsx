// Single transparent hint overlay. Four labels with kbd-styled curved
// cardinal arrows point at the legend, the place search input, the
// category pills, and the attribute-filter checkbox list — same visual
// treatment as the junction-turn glyphs on the Chinatown station pill.
// The overlay itself is pointer-events: none; clicks anywhere on the
// page dismiss it via a document-level listener in Walksheds.jsx.
// `hasActiveFilters` suppresses the filter hint when the checkbox list
// isn't rendered, so the arrow never points at empty space.

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
        <span className="hint-label">legend &mdash; walksheds, units, dark mode &amp; these hints</span>
        <kbd className="hint-arrow" aria-hidden="true">⤵</kbd>
      </div>

      <div className="hint hint-search">
        <span className="hint-label">search any place or feature</span>
        <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
      </div>

      <div className="hint hint-pills">
        <span className="hint-label">tap a pill to add a place type</span>
        <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
      </div>

      {hasActiveFilters && (
        <div className="hint hint-filters">
          <span className="hint-label">uncheck to drop an attribute filter</span>
          <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
        </div>
      )}
    </div>
  )
}
