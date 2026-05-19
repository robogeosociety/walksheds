// Single transparent hint overlay. Four cards with the curved cardinal
// arrow glyph (kbd-styled, matching the Chinatown junction-turn pill)
// inlined at the end of each label point at the legend, the place
// search input, the category pills, and the attribute-filter checkbox
// list. The overlay itself is pointer-events: none; clicks anywhere on
// the page dismiss it via a document-level listener in Walksheds.jsx.
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
        <span className="hint-label">
          legend &mdash; walksheds, units, dark mode &amp; these hints
          <kbd className="hint-arrow" aria-hidden="true">⤵</kbd>
        </span>
      </div>

      <div className="hint hint-search">
        <span className="hint-label">
          search any place or feature
          <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
        </span>
      </div>

      <div className="hint hint-pills">
        <span className="hint-label">
          tap a pill to add a place type
          <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
        </span>
      </div>

      {hasActiveFilters && (
        <div className="hint hint-filters">
          <span className="hint-label">
            uncheck to drop an attribute filter
            <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
          </span>
        </div>
      )}
    </div>
  )
}
