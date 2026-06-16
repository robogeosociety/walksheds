import { useEffect, useMemo, useReducer } from 'react'
import { Marker, useMap } from 'react-map-gl'
import { exitCode } from './stationExits'

// Floating exit markers styled as the green "EXIT" wayfinding signs at Link
// stations (see the Westlake exit board). One badge per exit of the selected
// station, rendered as a Mapbox Marker so it sits in the marker pane — above
// the canvas POI dots, peer to the station pill. A badge is suppressed when it
// would project on top of a station roundel, so exits never cover a station.

// Center-to-center pixel gap below which an exit badge is treated as overlapping
// a station icon (station roundel half + badge half + breathing room).
const STATION_CLEAR_PX = 30

// Re-render this component on every map move so the overlap test re-projects
// against the live camera. Returns a tick the projection memo depends on, so it
// recomputes as the camera settles after framing and on every later pan/zoom.
// Throttled to one recompute per animation frame.
function useMapTick(mapRef) {
  const [tick, bump] = useReducer(x => x + 1, 0)
  useEffect(() => {
    const map = mapRef?.getMap?.()
    if (!map) return
    let raf = 0
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(bump) }
    map.on('move', onMove)
    map.on('load', onMove)
    bump() // recompute once now that the map ref is available
    return () => { map.off('move', onMove); map.off('load', onMove); cancelAnimationFrame(raf) }
  }, [mapRef])
  return tick
}

export default function StationExitMarkers({ exits, bestExitId, stationsData, selectedStationKey, onExitClick }) {
  const mapRef = useMap().current
  const tick = useMapTick(mapRef)

  // Collision is tested against *other* stations only. The exits belong to the
  // selected station, so its own roundel must not hide them — the station pill
  // already paints over any exit tucked behind it (DOM order).
  const stationPoints = useMemo(
    () => (stationsData?.features || [])
      .filter(f => `${f.properties.lines}-${f.properties.stopCode}` !== selectedStationKey)
      .map(f => f.geometry.coordinates),
    [stationsData, selectedStationKey],
  )

  // Hide any exit whose screen position lands on another station's roundel.
  // Computed inline (not memoized) so it re-projects against the live camera on
  // every `tick` — the initial frame is zoomed out, where everything collides.
  const list = Array.isArray(exits) ? exits : []
  let visible = list
  if (mapRef && list.length && tick >= 0) {
    try {
      const stationPx = stationPoints.map(c => mapRef.project(c))
      visible = list.filter(e => {
        const p = mapRef.project(e.coordinates)
        return !stationPx.some(q => Math.hypot(p.x - q.x, p.y - q.y) < STATION_CLEAR_PX)
      })
    } catch { /* map not ready to project yet */ }
  }

  return visible.map(exit => {
    const isBest = exit.id === bestExitId
    return (
      <Marker key={exit.id} longitude={exit.coordinates[0]} latitude={exit.coordinates[1]} anchor="center" style={{ zIndex: 1 }}>
        <div
          className={`station-exit-badge${isBest ? ' best' : ''}`}
          onClick={() => onExitClick?.(exit)}
          role="button"
          aria-label={`Exit ${exitCode(exit)}${isBest ? ', best exit' : ''}`}
        >
          <span className="exit-badge-exit">EXIT</span>
          <span className="exit-badge-code">{exitCode(exit)}</span>
        </div>
      </Marker>
    )
  })
}
