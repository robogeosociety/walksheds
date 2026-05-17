import { MAPBOX_TOKEN } from './constants'
import { pointInPolygon } from './poiUtils'

const walkshedCache = new Map()

export async function fetchWalkshed(lng, lat, minutes) {
  const key = `${lng},${lat},${minutes}`
  const cached = walkshedCache.get(key)
  if (cached) return cached

  const url = `https://api.mapbox.com/isochrone/v1/mapbox/walking/${lng},${lat}`
    + `?contours_minutes=${minutes}&polygons=true&access_token=${MAPBOX_TOKEN}`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const data = await resp.json()
  walkshedCache.set(key, data)
  return data
}

export function polygonToLine(geojson) {
  if (!geojson?.features?.length) return geojson
  return {
    type: 'FeatureCollection',
    features: geojson.features.map(f => ({
      type: 'Feature',
      properties: f.properties,
      geometry: { type: 'LineString', coordinates: f.geometry.coordinates[0] },
    })),
  }
}

/**
 * Compute where the map should snap back to after a user pan, or null if it
 * should be left alone. Returns the POI coords when a popup is open
 * (every popup goes through a flyTo, so popup-exists ⇔ POI-is-centered),
 * the station coords when no popup is open, and null when the current map
 * center is outside the largest enabled walkshed ring (user deliberately
 * panned away).
 */
export function computeSnapTarget({ mapCenter, walksheds, enabledWalksheds, popup, poiPopup }) {
  if (!popup) return null
  const sorted = [...enabledWalksheds].sort((a, b) => b - a)
  let ring = null
  for (const min of sorted) {
    const candidate = walksheds[min]?.features?.[0]?.geometry?.coordinates?.[0]
    if (candidate) { ring = candidate; break }
  }
  if (!ring || !pointInPolygon(mapCenter, ring)) return null
  if (poiPopup) return [poiPopup.longitude, poiPopup.latitude]
  return [popup.longitude, popup.latitude]
}

export function getLargestEnabledBounds(walksheds, enabledWalksheds) {
  const sorted = [...enabledWalksheds].sort((a, b) => b - a)
  for (const min of sorted) {
    const ws = walksheds[min]
    const coords = ws?.features?.[0]?.geometry?.coordinates?.[0]
    if (!coords) continue
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const [cLng, cLat] of coords) {
      if (cLng < minLng) minLng = cLng
      if (cLng > maxLng) maxLng = cLng
      if (cLat < minLat) minLat = cLat
      if (cLat > maxLat) maxLat = cLat
    }
    return [[minLng, minLat], [maxLng, maxLat]]
  }
  return null
}
