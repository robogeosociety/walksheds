import { useState, useEffect } from 'react'
import { Marker } from 'react-map-gl'
import { LINE_COLORS } from './constants'

const LINE_1_COLOR = LINE_COLORS['1-line'].color
const LINE_2_COLOR = LINE_COLORS['2-line'].color

// Unicode glyphs encoding the track's direction at each special station.
// ↳ = south-then-east curve (Line 2 diverging at Chinatown).
// ⤒ ⤓ ⇥ = "arrow to bar" — the bar is the buffer-stop / end-of-track.
const SWITCH_GLYPH = '↳'
const TERMINUS_GLYPHS = {
  ArrowUp: '⤒',
  ArrowDown: '⤓',
  ArrowRight: '⇥',
  ArrowLeft: '⇤',
}

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
 * Chinatown junction: a small Line-2 circle paired with the south-then-
 * east branch arrow, so the badge explicitly says "Line 2 branches east".
 */
function SwitchBadge() {
  return (
    <span
      className="pill-badge"
      role="img"
      aria-label="Junction: Line 2 branches east"
    >
      <span className="pill-badge-line-circle" style={{ background: LINE_2_COLOR }}>2</span>
      <span className="pill-badge-glyph" style={{ color: LINE_2_COLOR }}>{SWITCH_GLYPH}</span>
    </span>
  )
}

/**
 * Terminus end-of-line. The arrow-to-bar glyph encodes the cardinal the
 * line runs off the map in (Lynnwood north, Federal Way south, Downtown
 * Redmond east). When both lines terminate at the same station
 * (Lynnwood), one glyph per line color is rendered.
 */
function TerminusBadge({ direction, lines }) {
  const glyph = TERMINUS_GLYPHS[direction] || TERMINUS_GLYPHS.ArrowUp
  return (
    <span className="pill-badge" role="img" aria-label="End of line">
      {lines.map(line => (
        <span
          key={line}
          className="pill-badge-glyph"
          style={{ color: line === '1-line' ? LINE_1_COLOR : LINE_2_COLOR }}
        >
          {glyph}
        </span>
      ))}
    </span>
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
        {expanded && junctionHints.length > 0 && <SwitchBadge />}
        {expanded && junctionHints.length === 0 && terminusInfo && (
          <TerminusBadge direction={terminusInfo.arrowKey} lines={terminusInfo.lines} />
        )}
      </div>
    </Marker>
  )
}

