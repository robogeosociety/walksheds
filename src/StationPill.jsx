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

// Hand-drawn d-pad arrows in the hint-overlay ink: the same wobbly
// glyphs as the overlay (rotated for each cardinal), each path doubled
// with a halo stroke (.hint-arrow-halo / .hint-arrow-ink) for
// readability over arbitrary map content.
const DPAD_GLYPH_H = [
  'M 2 9.5 C 8 8.2, 16 10.6, 24 9 S 34 9.8, 40 9.2',
  'M 33 3.5 L 40.5 9.2 L 33 14.8',
]
const DPAD_GLYPH_V = [
  'M 11.5 2 C 9.8 9, 12.2 16, 10.6 23 S 12.4 32, 11 37.5',
  'M 5.2 30 L 11 38 L 16.8 30',
]

function DpadArrow({ arrowKey }) {
  const horizontal = arrowKey === 'ArrowLeft' || arrowKey === 'ArrowRight'
  const paths = horizontal ? DPAD_GLYPH_H : DPAD_GLYPH_V
  const flip = arrowKey === 'ArrowLeft' || arrowKey === 'ArrowUp'
  return (
    <svg
      className={`dpad-arrow${flip ? ' flip' : ''}`}
      viewBox={horizontal ? '0 0 44 18' : '0 0 22 40'}
      width={horizontal ? 44 : 22}
      height={horizontal ? 18 : 40}
      aria-hidden="true"
    >
      {paths.map(d => <path key={`h${d}`} className="hint-arrow-halo" d={d} />)}
      {paths.map(d => <path key={`i${d}`} className="hint-arrow-ink" d={d} />)}
    </svg>
  )
}

const DPAD_DIRECTION = {
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowLeft: 'left',
}

/**
 * Onboarding d-pad around the active station's pill (replaces the old
 * single swipe hint): one arm per navigable direction, the arrow
 * pointing the way you travel and labeled with the destination. Arms
 * that diverge onto the other line carry its roundel, echoing the
 * junction badge.
 */
function DpadArm({ hint, currentLine }) {
  const direction = DPAD_DIRECTION[hint.arrowKey]
  const diverges = currentLine && hint.line !== currentLine
  const label = (
    <span className="dpad-label">
      {diverges && (
        <span
          className="pill-badge-line-circle"
          style={{ background: LINE_COLORS[hint.line]?.color || '#999' }}
        >
          {hint.line === '1-line' ? '1' : '2'}
        </span>
      )}
      {hint.label}
    </span>
  )
  return (
    <div className={`dpad-arm dpad-${direction}`} data-dpad-direction={direction} aria-hidden="true">
      {(direction === 'up' || direction === 'left') && label}
      <DpadArrow arrowKey={hint.arrowKey} />
      {(direction === 'down' || direction === 'right') && label}
    </div>
  )
}

export default function StationPill({ longitude, latitude, lines, stopCode, name, junctionHints, terminusInfo, dpad, currentLine }) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const timer = requestAnimationFrame(() => setExpanded(true))
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <Marker longitude={longitude} latitude={latitude} anchor="center" style={{ zIndex: 5 }}>
      <div className="station-pill-anchor">
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
        {expanded && dpad?.length > 0 && dpad.map(hint => (
          <DpadArm key={hint.arrowKey} hint={hint} currentLine={currentLine} />
        ))}
      </div>
    </Marker>
  )
}

