import { Marker } from 'react-map-gl'

// Hand-drawn cards anchored to each enabled walkshed ring. The Marker
// projects the lat/lng anchor into screen coords so the cards stay
// pinned to the polygon edge as the map pans/zooms. The Marker wrapper
// is pointer-events: none (via inline style — react-map-gl v7 Marker
// only forwards `style`, not `className`) so a click anywhere passes
// through to the document-level handler in Walksheds.jsx that dismisses
// the hint overlay.
const MARKER_STYLE = { pointerEvents: 'none', zIndex: 5 }

export default function WalkshedHints({ hints }) {
  if (!hints?.length) return null
  return hints.map(({ min, count, breakdown, anchor }) => (
    <Marker
      key={min}
      longitude={anchor[0]}
      latitude={anchor[1]}
      anchor="bottom"
      style={MARKER_STYLE}
    >
      <div className="walkshed-hint">
        <div className="walkshed-hint-title">{min} min walk</div>
        <div className="walkshed-hint-count">
          {count.toLocaleString()} {count === 1 ? 'place' : 'places'} reachable
        </div>
        {breakdown.length > 0 && (
          <div className="walkshed-hint-breakdown">
            {breakdown.map((b, i) => (
              <span key={b.group} className="walkshed-hint-group">
                {i > 0 && <span className="walkshed-hint-sep"> · </span>}
                <span className="walkshed-hint-dot" style={{ background: b.color }} />
                {b.count} {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Marker>
  ))
}
