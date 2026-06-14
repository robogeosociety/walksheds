// Station exit/entrance helpers (issue: station exit maps).
//
// public/station-exits.geojson is a flat FeatureCollection of entrance points,
// each tagged with the `stationKey` ({lines}-{stopCode}) of its nearest Link
// station (assigned at build time — see data/pois/fetch_station_exits.py).
// The runtime groups them per station and, when a POI is in context, picks the
// exit physically closest to that POI by straight-line distance. Coverage is
// partial: stations with no OSM-mapped entrances simply have no exits here, and
// the UI shows "Exits not yet mapped" for them.

const EARTH_RADIUS_M = 6371000

// Straight-line (haversine) distance in meters between two [lng, lat] points.
export function haversineMeters(a, b) {
  const toRad = Math.PI / 180
  const p1 = a[1] * toRad
  const p2 = b[1] * toRad
  const dPhi = (b[1] - a[1]) * toRad
  const dLng = (b[0] - a[0]) * toRad
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Flatten a station-exits GeoJSON feature into the shape the UI consumes.
function toExit(feature) {
  const p = feature.properties || {}
  return {
    id: p.id,
    stationKey: p.stationKey,
    stationName: p.stationName,
    name: p.name,
    bearing: p.bearingFromStation,
    accessible: !!p.accessible,
    coordinates: feature.geometry.coordinates,
  }
}

// Build a Map(stationKey -> exits[]) from the loaded FeatureCollection, so the
// panel can look up a station's exits without scanning every feature.
export function indexExitsByStation(geojson) {
  const index = new Map()
  if (!geojson || !Array.isArray(geojson.features)) return index
  for (const f of geojson.features) {
    const exit = toExit(f)
    if (!exit.stationKey) continue
    const list = index.get(exit.stationKey)
    if (list) list.push(exit)
    else index.set(exit.stationKey, [exit])
  }
  return index
}

export function exitsForStation(index, stationKey) {
  if (!index || !stationKey) return []
  return index.get(stationKey) || []
}

// The exit nearest a target point by straight-line distance. Returns
// { exit, meters } or null when there are no exits.
export function nearestExit(exits, target) {
  if (!Array.isArray(exits) || exits.length === 0 || !target) return null
  let best = null
  let bestMeters = Infinity
  for (const exit of exits) {
    const m = haversineMeters(exit.coordinates, target)
    if (m < bestMeters) {
      best = exit
      bestMeters = m
    }
  }
  return best ? { exit: best, meters: bestMeters } : null
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

// Nearest 8-point compass label for a bearing in degrees (0 = north).
export function compassLabel(deg) {
  if (deg == null || !isFinite(deg)) return ''
  return COMPASS_8[Math.round(deg / 45) % 8]
}
