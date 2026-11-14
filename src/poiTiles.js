/**
 * Runtime spatial-tile loading for POIs.
 *
 * The build (data/pois/build_refined.py) emits
 * public/cities/<slug>/pois/tiles/{col}_{row}.geojson
 * — a spatial grid over the full POI set — plus tiles/index.json with the grid
 * params and the keys of populated tiles. Instead of loading the whole 11.7 MB
 * dataset upfront, the app loads only the handful of tiles overlapping the active
 * walkshed bbox (typically ~11 tiles, ~350 KB gzip downtown), caching each tile so repeated
 * station visits are free.
 */

// Both caches are keyed by `base` (a city's public data root), so switching
// cities cannot serve one city's tiles for another, and switching back is free.
const tileIndexes = new Map()  // base -> { base, tileDeg, count, tiles, stationTiles }
const tileCache = new Map()    // `${base}|c_r` -> Promise<Feature[]>

/** Load and memoize a city's tiles/index.json. */
export async function loadTileIndex(base) {
  const cached = tileIndexes.get(base)
  if (cached) return cached
  const res = await fetch(`${base}pois/tiles/index.json`)
  if (!res.ok) throw new Error(`tile index ${res.status}`)
  const raw = await res.json()
  const tileIndex = {
    // The data root this index was loaded from. Tiles are always fetched from
    // the same root (see loadPoisForWalkshed), so the index and its tiles can
    // never be resolved against different paths.
    base,
    tileDeg: raw.tile_deg,
    count: raw.count,
    tiles: new Set(raw.tiles),
    // station key ("{lines}-{stopCode}") -> precomputed tile keys, so a station
    // selection skips the bbox math (the build already overlapped its walkshed
    // against the grid). Runtime still clips against the live isochrone.
    stationTiles: raw.station_tiles || {},
  }
  tileIndexes.set(base, tileIndex)
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

/**
 * Fetch one tile's features (cached). Missing tiles resolve to [].
 *
 * `priority` is a fetch priority hint ('low' for prefetches, so they yield to
 * the map's own requests on a shared connection). The first request for a
 * tile sets it; later callers share the cached promise.
 */
function loadTile(base, key, priority) {
  const cacheKey = `${base}|${key}`
  if (!tileCache.has(cacheKey)) {
    const url = `${base}pois/tiles/${key}.geojson`
    tileCache.set(cacheKey, (priority ? fetch(url, { priority }) : fetch(url))
      .then(r => (r.ok ? r.json() : { features: [] }))
      .then(fc => fc.features ?? [])
      .catch(() => []))
  }
  return tileCache.get(cacheKey)
}

/**
 * The tile keys a walkshed touches: the build's precomputed station lookup
 * when `stationKey` is in it (no bbox math), else the walkshed polygon's bbox.
 */
function walkshedTileKeys(walkshedFC, index, stationKey) {
  const keys = stationKey ? index.stationTiles?.[stationKey] : null
  if (keys) return keys
  const bbox = walkshedBbox(walkshedFC)
  return bbox ? tileKeysForBbox(bbox, index) : []
}

/**
 * Order tile keys nearest-first to `center` ([lng, lat]), by the distance
 * from each grid cell's centre. Longitude is scaled by cos(latitude), so the
 * order holds at any latitude the app serves.
 */
export function orderTilesByDistance(keys, index, center) {
  const d = index.tileDeg
  const [lng, lat] = center
  const kx = Math.cos((lat * Math.PI) / 180)
  const dist = (key) => {
    const [col, row] = key.split('_').map(Number)
    const dx = ((col + 0.5) * d - lng) * kx
    const dy = (row + 0.5) * d - lat
    return dx * dx + dy * dy
  }
  return [...keys].sort((a, b) => dist(a) - dist(b))
}

/**
 * Stream the POI tiles a walkshed touches. Every tile is requested at once,
 * nearest-first to `center` when given, and `onTile(features, key)` fires as
 * each one lands, so the caller can draw the closest POIs while the far tiles
 * are still downloading. Resolves to the flat Feature[] of all tiles (a
 * superset of the walkshed; the caller still point-in-polygon clips).
 *
 * Tiles are fetched from `index.base`, the root the index itself came from.
 */
export function streamPoisForWalkshed(walkshedFC, index, stationKey, { center, onTile, priority } = {}) {
  let keys = walkshedTileKeys(walkshedFC, index, stationKey)
  if (center) keys = orderTilesByDistance(keys, index, center)
  return Promise.all(keys.map(k => loadTile(index.base, k, priority).then((features) => {
    onTile?.(features, k)
    return features
  }))).then(chunks => chunks.flat())
}

/** Load every POI feature in the tiles a walkshed touches, all at once. */
export function loadPoisForWalkshed(walkshedFC, index, stationKey) {
  return streamPoisForWalkshed(walkshedFC, index, stationKey)
}
