import { useState, useEffect } from 'react'
import { Marker } from 'react-map-gl'
import { LINE_COLORS } from './constants'

const LINE_1_COLOR = LINE_COLORS['1-line'].color
const LINE_2_COLOR = LINE_COLORS['2-line'].color

// Termini use Unicode arrow-to-bar glyphs — the bar reads as the buffer-stop.
// The junction badge uses an inline SVG below for a bolder stroke and a
// true circular-arc elbow that the Unicode ↳ glyph can't deliver.
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
 * Chinatown junction: a small Line-2 circle paired with a south-then-east
 * branch arrow drawn as inline SVG (bolder stroke + true circular arc at
 * the elbow than the Unicode ↳ glyph can provide).
 */
function SwitchBadge() {
  return (
    <span
      className="pill-badge"
      role="img"
      aria-label="Junction: Line 2 branches east"
    >
      <span className="pill-badge-line-circle" style={{ background: LINE_2_COLOR }}>2</span>
      <svg
        className="pill-badge-arrow"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        style={{ color: LINE_2_COLOR }}
        aria-hidden
      >
        <path
          d="M 6 3 V 13 A 4 4 0 0 0 10 17 H 19 M 16 14 L 19 17 L 16 20"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
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

