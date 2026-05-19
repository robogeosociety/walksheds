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
 * center is outside the snap ring.
 *
 * The snap ring is the **second-largest** enabled-and-loaded walkshed
 * (e.g. 10-min when 5/10/15 are all on). Using the largest made it too
 * hard to pan-navigate to neighboring stations along the trunk — the
 * 15-min rings of adjacent downtown stations overlap, so any pan toward
 * a neighbor immediately snapped back. With n-1, the outer band acts as
 * a "release zone" where panning lets you keep moving toward the next
 * station. When only one walkshed is enabled there's no n-1, so we fall
 * back to that one ring.
 */
export function computeSnapTarget({ mapCenter, walksheds, enabledWalksheds, popup, poiPopup }) {
  if (!popup) return null
  const loadedRings = [...enabledWalksheds]
    .sort((a, b) => b - a)
    .map(min => walksheds[min]?.features?.[0]?.geometry?.coordinates?.[0])
    .filter(Boolean)
  if (loadedRings.length === 0) return null
  const ring = loadedRings[loadedRings.length >= 2 ? 1 : 0]
  if (!pointInPolygon(mapCenter, ring)) return null
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
