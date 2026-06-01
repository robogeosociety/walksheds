/**
 * Runtime spatial-tile loading for POIs.
 *
 * The build (data/pois/build_refined.py) emits public/pois/tiles/{col}_{row}.geojson
 * — a spatial grid over the full POI set — plus tiles/index.json with the grid
 * params and the keys of populated tiles. Instead of loading the whole 11.7 MB
 * dataset upfront, the app loads only the handful of tiles overlapping the active
 * walkshed bbox (typically ~11 tiles, ~20 KB), caching each tile so repeated
 * station visits are free.
 */

let tileIndex = null         // { tile_deg, count, tiles: Set<string> }
const tileCache = new Map()  // "c_r" -> Promise<Feature[]>

/** Load and memoize tiles/index.json. */
export async function loadTileIndex(base) {
  if (tileIndex) return tileIndex
  const res = await fetch(`${base}pois/tiles/index.json`)
  if (!res.ok) throw new Error(`tile index ${res.status}`)
  const raw = await res.json()
  tileIndex = {
    tileDeg: raw.tile_deg,
    count: raw.count,
    tiles: new Set(raw.tiles),
    // station key ("{lines}-{stopCode}") -> precomputed tile keys, so a station
    // selection skips the bbox math (the build already overlapped its walkshed
    // against the grid). Runtime still clips against the live isochrone.
    stationTiles: raw.station_tiles || {},
  }
  return tileIndex
}

/** Tile keys covering a [minLon, minLat, maxLon, maxLat] bbox, populated only. */
export function tileKeysForBbox(bbox, index) {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const d = index.tileDeg
  const c0 = Math.floor(minLon / d), c1 = Math.floor(maxLon / d)
  const r0 = Math.floor(minLat / d), r1 = Math.floor(maxLat / d)
  const keys = []
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      const key = `${c}_${r}`
      if (index.tiles.has(key)) keys.push(key)
    }
  }
  return keys
}

/** Bounding box of a walkshed FeatureCollection's outer rings. */
export function walkshedBbox(walkshedFC) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  for (const f of walkshedFC?.features ?? []) {
    const ring = f.geometry?.coordinates?.[0]
    if (!ring) continue
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (minLon === Infinity) return null
  return [minLon, minLat, maxLon, maxLat]
}

/** Fetch one tile's features (cached). Missing tiles resolve to []. */
function loadTile(base, key) {
  if (!tileCache.has(key)) {
    tileCache.set(key, fetch(`${base}pois/tiles/${key}.geojson`)
      .then(r => (r.ok ? r.json() : { features: [] }))
      .then(fc => fc.features ?? [])
      .catch(() => []))
  }
  return tileCache.get(key)
}

/**
 * Load every POI feature in the tiles a walkshed touches. Returns a flat
 * Feature[] (a superset of the walkshed — caller still point-in-polygon clips).
 *
 * When `stationKey` is given and present in the precomputed `stationTiles`
 * lookup, uses that directly (no bbox math). Otherwise falls back to computing
 * the tiles from the walkshed polygon's bbox.
 */
export async function loadPoisForWalkshed(base, walkshedFC, index, stationKey) {
  let keys = stationKey ? index.stationTiles?.[stationKey] : null
  if (!keys) {
    const bbox = walkshedBbox(walkshedFC)
    if (!bbox) return []
    keys = tileKeysForBbox(bbox, index)
  }
  const chunks = await Promise.all(keys.map(k => loadTile(base, k)))
  return chunks.flat()
}
