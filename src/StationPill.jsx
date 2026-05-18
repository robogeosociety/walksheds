import { useState, useEffect } from 'react'
import { Marker } from 'react-map-gl'
import { LINE_COLORS } from './constants'

const ARROW_SYMBOLS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

const LINE_1_COLOR = LINE_COLORS['1-line'].color
const LINE_2_COLOR = LINE_COLORS['2-line'].color

/**
 * Pure pill body — used by the on-map StationPill (wrapped in a Mapbox
 * Marker) and by the POI popup's "Nearest stations" rows. No animations,
 * no junction/terminus badges.
 */
export function StationPillBody({ lines, stopCode, name, className }) {
  const lineArr = lines.split(',')
  return (
    <div className={className ? `station-pill ${className}` : 'station-pill'}>
      <div className="pill-lines">
        {lineArr.map(num => (
          <span
            key={num}
            className="pill-circle"
            style={{ background: LINE_COLORS[`${num.trim()}-line`]?.color || '#999' }}
          >
            {num.trim()}
          </span>
        ))}
      </div>
      {stopCode != null && <span className="pill-code">{stopCode}</span>}
      <span className="pill-name">{name.replace(' Station', '')}</span>
    </div>
  )
}

/**
 * Junction switch glyph: a vertical Line 1 (green) trunk with a Line 2
 * (blue) branch diverging east, depicting the Chinatown split. Each
 * branch ends in a small in-SVG keyboard chip showing the arrow the
 * user can press to follow that branch (e.g. ↓ at the bottom of the
 * trunk for Line 1 south, → at the right of the branch for Line 2 east).
 */
function SwitchBadge({ hints }) {
  const hintFor = (line) => hints.find(h => h.line === line)
  const h1 = hintFor('1-line')
  const h2 = hintFor('2-line')

  return (
    <div className="pill-badge pill-badge-junction">
      <svg
        className="pill-badge-svg"
        width="42"
        height="34"
        viewBox="0 0 42 34"
        role="img"
        aria-label={
          'Junction: ' +
          [h1 && `${ARROW_SYMBOLS[h1.arrowKey]} for Line 1`, h2 && `${ARROW_SYMBOLS[h2.arrowKey]} for Line 2`]
            .filter(Boolean)
            .join(', ')
        }
      >
        <line x1="8" y1="0" x2="8" y2="22" stroke={LINE_1_COLOR} strokeWidth="3" strokeLinecap="round" />
        <line x1="8" y1="11" x2="26" y2="11" stroke={LINE_2_COLOR} strokeWidth="3" strokeLinecap="round" />
        {h1 && (
          <>
            <rect className="badge-kbd" x="0.5" y="22.5" width="15" height="11" rx="2.5" />
            <text className="badge-kbd-text" x="8" y="30.5">{ARROW_SYMBOLS[h1.arrowKey]}</text>
          </>
        )}
        {h2 && (
          <>
            <rect className="badge-kbd" x="26" y="5.5" width="15" height="11" rx="2.5" />
            <text className="badge-kbd-text" x="33.5" y="13.5">{ARROW_SYMBOLS[h2.arrowKey]}</text>
          </>
        )}
      </svg>
    </div>
  )
}

/**
 * Terminus glyph: a colored rail capped by a perpendicular bumper at
 * the end-of-line side. Direction encodes which way the line "runs off
 * the map"; lines={["1-line","2-line"]} (Lynnwood) draws both rails in
 * parallel, otherwise a single rail in the terminating line's color.
 */
function TerminusBadge({ direction, lines }) {
  const isBoth = lines.length === 2
  const railColor = lines[0] === '1-line' ? LINE_1_COLOR : LINE_2_COLOR
  const BUMPER = '#666'

  // Each variant is hand-laid-out rather than rotated so the per-direction
  // proportions (single rail vs double rail; squat horizontal vs tall vertical)
  // can be tuned independently.
  if (direction === 'ArrowUp') {
    // North terminus (Lynnwood): bumper at top, rails go down (south).
    return (
      <div className="pill-badge pill-badge-terminus" aria-hidden>
        <svg className="pill-badge-svg" width="22" height="22" viewBox="0 0 22 22">
          <line x1="2" y1="3" x2="20" y2="3" stroke={BUMPER} strokeWidth="3.5" strokeLinecap="round" />
          {isBoth ? (
            <>
              <line x1="8" y1="3" x2="8" y2="22" stroke={LINE_1_COLOR} strokeWidth="3" strokeLinecap="round" />
              <line x1="14" y1="3" x2="14" y2="22" stroke={LINE_2_COLOR} strokeWidth="3" strokeLinecap="round" />
            </>
          ) : (
            <line x1="11" y1="3" x2="11" y2="22" stroke={railColor} strokeWidth="3" strokeLinecap="round" />
          )}
        </svg>
      </div>
    )
  }
  if (direction === 'ArrowDown') {
    // South terminus (Federal Way Line 1): bumper at bottom, rail goes up.
    return (
      <div className="pill-badge pill-badge-terminus" aria-hidden>
        <svg className="pill-badge-svg" width="22" height="22" viewBox="0 0 22 22">
          <line x1="11" y1="0" x2="11" y2="19" stroke={railColor} strokeWidth="3" strokeLinecap="round" />
          <line x1="2" y1="19" x2="20" y2="19" stroke={BUMPER} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  if (direction === 'ArrowRight') {
    // East terminus (Downtown Redmond Line 2): bumper at right, rail goes left.
    return (
      <div className="pill-badge pill-badge-terminus" aria-hidden>
        <svg className="pill-badge-svg" width="22" height="22" viewBox="0 0 22 22">
          <line x1="0" y1="11" x2="19" y2="11" stroke={railColor} strokeWidth="3" strokeLinecap="round" />
          <line x1="19" y1="2" x2="19" y2="20" stroke={BUMPER} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  // direction === 'ArrowLeft' — west terminus (no line uses this today; render mirror of east).
  return (
    <div className="pill-badge pill-badge-terminus" aria-hidden>
      <svg className="pill-badge-svg" width="22" height="22" viewBox="0 0 22 22">
        <line x1="3" y1="11" x2="22" y2="11" stroke={railColor} strokeWidth="3" strokeLinecap="round" />
        <line x1="3" y1="2" x2="3" y2="20" stroke={BUMPER} strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export default function StationPill({ longitude, latitude, lines, stopCode, name, junctionHints, terminusInfo }) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const timer = requestAnimationFrame(() => setExpanded(true))
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <Marker longitude={longitude} latitude={latitude} anchor="center">
      <div className={`station-pill ${expanded ? 'expanded' : ''}`}>
        <div className="pill-lines">
          {lines.split(',').map(num => (
            <span
              key={num}
              className="pill-circle"
              style={{ background: LINE_COLORS[`${num.trim()}-line`]?.color || '#999' }}
            >
              {num.trim()}
            </span>
          ))}
        </div>
        {stopCode != null && <span className="pill-code">{stopCode}</span>}
        <span className="pill-name">{name.replace(' Station', '')}</span>
        {expanded && junctionHints.length > 0 && <SwitchBadge hints={junctionHints} />}
        {expanded && junctionHints.length === 0 && terminusInfo && (
          <TerminusBadge direction={terminusInfo.arrowKey} lines={terminusInfo.lines} />
        )}
      </div>
    </Marker>
  )
}
