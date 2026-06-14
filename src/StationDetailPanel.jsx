import { useMemo } from 'react'
import { StationPillBody } from './StationPill'
import { LINE_COLORS } from './constants'
import { formatDistance } from './formatDistance'
import { nearestExit, compassLabel } from './stationExits'

// Station detail card (station exit maps): expands from the selected station,
// mirroring POIPopupCard. Shows the lines served, an accessibility note, and the
// station's exits/entrances. When a POI is in context, the exit physically
// closest to it (straight-line) is badged "Best for …" and sorted first, so a
// rider knows which way to leave the platform. Pure component (no Mapbox
// context) so it can be unit-tested like POIPopupCard.

// A classic map north-arrow rendered as a small compass needle, rotated to a
// bearing (0 = up/north) so the row points the way you'd walk out of the
// station toward that exit on the north-up map.
function BearingArrow({ bearing }) {
  return (
    <svg
      className="station-detail-arrow"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <g transform={`rotate(${bearing || 0} 12 12)`}>
        {/* Filled north half + open south half — the legend convention. */}
        <path d="M12 3 L16 13 L12 11 Z" fill="currentColor" />
        <path d="M12 3 L8 13 L12 11 Z" fill="currentColor" opacity="0.35" />
        <path d="M12 11 L12 20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  )
}

// Small inline accessibility mark (wheelchair) for step-free exits.
function AccessibleMark() {
  return (
    <svg className="station-detail-access" width="13" height="13" viewBox="0 0 24 24" aria-label="Step-free access" role="img">
      <circle cx="12" cy="4" r="2" fill="currentColor" />
      <path d="M9 7h2v6h5l2 6M11 10h5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 13a5 5 0 1 0 4 8" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export default function StationDetailPanel({ station, exits, contextPoi, onClose, onExitClick, onPopupFocus, units }) {
  const lineArr = (station.lines || '').split(',').map(s => s.trim()).filter(Boolean)

  // Best exit for the POI in context (straight-line nearest). null when no POI
  // is open or the station has no mapped exits.
  const best = useMemo(() => {
    if (!contextPoi || !Array.isArray(exits) || exits.length === 0) return null
    const target = [contextPoi.longitude, contextPoi.latitude]
    return nearestExit(exits, target)
  }, [contextPoi, exits])

  // Best first (when in context), then by bearing for a stable clockwise order.
  const ordered = useMemo(() => {
    const list = [...(exits || [])]
    list.sort((a, b) => {
      if (best) {
        if (a.id === best.exit.id) return -1
        if (b.id === best.exit.id) return 1
      }
      return (a.bearing ?? 0) - (b.bearing ?? 0)
    })
    return list
  }, [exits, best])

  const accessibleCount = (exits || []).filter(e => e.accessible).length

  return (
    <div className="poi-popup station-detail" onMouseDown={onPopupFocus}>
      <div className="poi-popup-header station-detail-header">
        <StationPillBody lines={station.lines} stopCode={station.stopCode} name={station.name} className="inline" />
        <span className="poi-popup-close" onClick={onClose} role="button" aria-label="Close">
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      <div className="station-detail-meta">
        <span className="station-detail-meta-label">Serves</span>
        {lineArr.map(num => (
          <span key={num} className="station-detail-line">
            <span className="pill-circle" style={{ background: LINE_COLORS[`${num}-line`]?.color || '#999' }}>{num}</span>
            <span className="station-detail-line-text">{num} Line</span>
          </span>
        ))}
        {accessibleCount > 0 && (
          <span className="station-detail-access-note">
            <AccessibleMark />
            {accessibleCount} step-free
          </span>
        )}
      </div>

      <div className="poi-popup-stations station-detail-exits">
        <div className="poi-popup-stations-label">Exits &amp; entrances</div>
        {ordered.length === 0 ? (
          <div className="station-detail-empty">Exits not yet mapped</div>
        ) : (
          ordered.map(exit => {
            const isBest = best && exit.id === best.exit.id
            return (
              <button
                key={exit.id}
                className={`poi-popup-station-row station-detail-exit-row${isBest ? ' best' : ''}`}
                onClick={() => onExitClick?.(exit)}
                aria-label={`${exit.name}, ${compassLabel(exit.bearing)}${isBest ? `, best exit for ${contextPoi?.name}` : ''}`}
              >
                <BearingArrow bearing={exit.bearing} />
                <span className="station-detail-exit-name">
                  {exit.name}
                  {exit.accessible && <AccessibleMark />}
                </span>
                {isBest ? (
                  <span className="station-detail-best">Best · {formatDistance(best.meters, units)}</span>
                ) : (
                  <span className="station-detail-exit-dir">{compassLabel(exit.bearing)}</span>
                )}
              </button>
            )
          })
        )}
        {best && contextPoi && (
          <div className="station-detail-context">Closest exit to {contextPoi.name}</div>
        )}
      </div>
    </div>
  )
}
