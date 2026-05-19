import { useState, useEffect } from 'react'
import { Marker } from 'react-map-gl'
import { LINE_COLORS } from './constants'

const LINE_1_COLOR = LINE_COLORS['1-line'].color
const LINE_2_COLOR = LINE_COLORS['2-line'].color

// SVG paths drawn in a 24×24 viewBox: a bar at the terminus end + a
// shaft + a chevron arrowhead whose tip sits right against the bar.
// Same visual weight + rounded joins as the Chinatown switch arrow.
const TERMINUS_PATHS = {
  ArrowUp:    'M 5 4 H 19 M 8 9 L 12 5 L 16 9 M 12 5 V 21',
  ArrowDown:  'M 5 20 H 19 M 8 15 L 12 19 L 16 15 M 12 19 V 3',
  ArrowRight: 'M 20 5 V 19 M 15 8 L 19 12 L 15 16 M 19 12 H 3',
  ArrowLeft:  'M 4 5 V 19 M 9 8 L 5 12 L 9 16 M 5 12 H 21',
}

function ArrowSvg({ d, color }) {
  return (
    <svg
      className="pill-badge-arrow"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      style={{ color }}
      aria-hidden
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
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

// Chinatown switch: trunk down + quarter-circle elbow + chevron arrowhead.
const SWITCH_PATH = 'M 6 3 V 13 A 4 4 0 0 0 10 17 H 19 M 16 14 L 19 17 L 16 20'

/**
 * Chinatown junction: a small Line-2 circle paired with a south-then-east
 * branch arrow.
 */
function SwitchBadge() {
  return (
    <span
      className="pill-badge"
      role="img"
      aria-label="Junction: Line 2 branches east"
    >
      <span className="pill-badge-pair">
        <span className="pill-badge-line-circle" style={{ background: LINE_2_COLOR }}>2</span>
        <ArrowSvg d={SWITCH_PATH} color={LINE_2_COLOR} />
      </span>
    </span>
  )
}

/**
 * Terminus end-of-line. Each terminating line gets a small line-color
 * circle paired with an arrow-to-bar SVG (matching the [2] ↳ pattern at
 * the Chinatown junction). The cardinal of the arrow is the local
 * bearing into the station — see routeGraph.getTerminusInfo.
 */
function TerminusBadge({ direction, lines }) {
  const d = TERMINUS_PATHS[direction] || TERMINUS_PATHS.ArrowUp
  return (
    <span className="pill-badge" role="img" aria-label="End of line">
      {lines.map(line => {
        const lineNum = line === '1-line' ? '1' : '2'
        const color = line === '1-line' ? LINE_1_COLOR : LINE_2_COLOR
        return (
          <span key={line} className="pill-badge-pair">
            <span className="pill-badge-line-circle" style={{ background: color }}>{lineNum}</span>
            <ArrowSvg d={d} color={color} />
          </span>
        )
      })}
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

