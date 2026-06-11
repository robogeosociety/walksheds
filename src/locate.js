// Locate-control helpers (issue #16): find the station nearest a
// geolocation fix so the map can snap to it and open its walksheds.

// A fix farther than this from every station is outside the Link
// service corridor ("the 1 line / 2 line AOI") — locate then just shows
// the puck without snapping. 3 km ≈ the corridor half-width: generous
// enough to cover anywhere a 15-min walkshed could reach, without
// snapping users in, say, West Seattle to a station across the bay.
export const MAX_SNAP_METERS = 3000

const EARTH_RADIUS_M = 6371000

export function haversineMeters(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/**
 * Nearest station to a point, or null when there is no station data.
 * Returns { feature, distanceMeters }; callers decide whether the
 * distance is close enough to act on (MAX_SNAP_METERS).
 */
export function findNearestStation(stationsData, lng, lat) {
  let best = null
  for (const f of stationsData?.features || []) {
    const [sLng, sLat] = f.geometry.coordinates
    const d = haversineMeters(lng, lat, sLng, sLat)
    if (!best || d < best.distanceMeters) {
      best = { feature: f, distanceMeters: d }
    }
  }
  return best
}
