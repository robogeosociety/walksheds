// Single transparent hint overlay. Three labels with kbd-styled curved
// cardinal arrows point at the legend, the place search input, and the
// filter pills row — same visual treatment as the junction-turn glyphs on
// the Chinatown station pill. The overlay itself is pointer-events: none;
// clicks anywhere on the page dismiss it via a document-level listener
// in Walksheds.jsx.

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
        <kbd className="hint-arrow" aria-hidden="true">⤵</kbd>
      </div>

      <div className="hint hint-search">
        <span className="hint-label">search any place by name or category</span>
        <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
      </div>

      <div className="hint hint-pills">
        <span className="hint-label">tap a pill to filter what shows up on the map</span>
        <kbd className="hint-arrow" aria-hidden="true">⤷</kbd>
      </div>
    </div>
  )
}
