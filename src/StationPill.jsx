import { useState, useEffect } from 'react'
import { Marker } from 'react-map-gl'
import { LINE_COLORS } from './constants'

const ARROW_SYMBOLS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

/**
 * The pill body — no Marker, no animations. Used by the on-map StationPill
 * and by the POI popup's "Nearest stations" rows. Pure visual: lines + code + name.
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

export default function StationPill({ longitude, latitude, lines, stopCode, name, junctionHints }) {
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
        {expanded && junctionHints.length > 0 && (
          <div className="pill-hints">
            {junctionHints.map((hint) => (
              <span key={hint.line} className="pill-hint">
                <kbd>{ARROW_SYMBOLS[hint.arrowKey]}</kbd>
                {hint.line === '1-line' ? '1' : '2'}
              </span>
            ))}
          </div>
        )}
      </div>
    </Marker>
  )
}
