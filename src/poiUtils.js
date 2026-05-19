/**
 * POI filtering utilities — point-in-polygon, tag aggregation, and filter logic.
 */

/**
 * Ray-casting point-in-polygon test.
 * @param {[number, number]} point - [lng, lat]
 * @param {Array<[number, number]>} ring - polygon ring coordinates
 * @returns {boolean}
 */
export function pointInPolygon([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Filter POI features to those inside the walkshed polygon.
 * @param {Object} poiFC - GeoJSON FeatureCollection of POIs
 * @param {Object} walkshedFC - GeoJSON FeatureCollection from Mapbox Isochrone
 * @returns {Object} filtered FeatureCollection
 */
export function filterPOIsInWalkshed(poiFC, walkshedFC) {
  const ring = walkshedFC?.features?.[0]?.geometry?.coordinates?.[0]
  if (!ring || !poiFC?.features) return { type: 'FeatureCollection', features: [] }
  const features = poiFC.features.filter(f => {
    const coords = f.geometry?.coordinates
    return coords && pointInPolygon(coords, ring)
  })
  return { type: 'FeatureCollection', features }
}

/**
 * Get all unique tags from POI features with their counts, sorted by count descending.
 * Each tag's color comes from the `tagColors` map (tag → hex), built from
 * `public/pois/tag-categories.json`. Tags without an entry get null color.
 *
 * @param {Array} features - GeoJSON features with properties.tags arrays
 * @param {Object} [tagColors] - map of tag → color hex
 * @returns {Array<{tag: string, count: number, color: string|null}>}
 */
export function getAvailableTags(features, tagColors) {
  const counts = {}
  for (const f of features) {
    const tags = f.properties?.tags
    if (!Array.isArray(tags)) continue
    for (const tag of tags) {
      counts[tag] = (counts[tag] || 0) + 1
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({
      tag,
      count,
      color: tagColors?.[tag] || null,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * Filter features to those matching ANY active tag (OR logic).
 * @param {Array} features - GeoJSON features
 * @param {Set<string>} activeTags - tags where at least one must be present
 * @returns {Array} filtered features
 */
export function filterByTags(features, activeTags) {
  if (!activeTags || activeTags.size === 0) return features
  return features.filter(f => {
    const tags = f.properties?.tags
    if (!Array.isArray(tags)) return false
    for (const t of activeTags) {
      if (tags.includes(t)) return true
    }
    return false
  })
}

/**
 * Decide which POI features are visible given the three independent inputs:
 *
 *   - enabledSpotlights:  curated pill ids (restaurants, bars, coffee, parks,
 *                         everything). A spotlight with matchAll=true short-
 *                         circuits the category pool to every feature.
 *   - activeCategories:   user-added POI-type tags (pizza, museum, …). These
 *                         OR with the spotlight matches to form the pool.
 *   - activeFilters:      cross-cutting attribute tags (child-friendly,
 *                         vegan, wifi, …). Every active filter must be
 *                         present on a feature (AND across the set).
 *
 * Truth table is documented in README.md → "POI selection logic".
 *
 * @param {Array} features
 * @param {Object} opts
 * @param {Set<string>} opts.enabledSpotlights
 * @param {Set<string>} opts.activeCategories
 * @param {Set<string>} opts.activeFilters
 * @param {Object} opts.spotlightsById  - { [id]: { matchCategories[], matchTags[], matchAll? } }
 * @returns {Array} filtered features
 */
export function filterByCategoriesAndFilters(features, opts) {
  const enabledSpotlights = opts.enabledSpotlights || new Set()
  const activeCategories = opts.activeCategories || new Set()
  const activeFilters = opts.activeFilters || new Set()
  const spotlightsById = opts.spotlightsById || {}

  let matchAll = false
  const matchCats = new Set()
  const matchSpotlightTags = new Set()
  for (const id of enabledSpotlights) {
    const s = spotlightsById[id]
    if (!s) continue
    if (s.matchAll) { matchAll = true; continue }
    for (const c of s.matchCategories || []) matchCats.add(c)
    for (const t of s.matchTags || []) matchSpotlightTags.add(t)
  }

  // Pool = features matching any category source (spotlight or activeCategory).
  // matchAll short-circuits to every feature. If no category source is active,
  // the pool is empty — preserves "empty pill bar ⇒ empty map" behaviour.
  const hasAnyCat = matchAll || enabledSpotlights.size > 0 || activeCategories.size > 0
  if (!hasAnyCat) return []

  const pool = matchAll
    ? features
    : features.filter(f => {
        const props = f.properties || {}
        if (props.category && matchCats.has(props.category)) return true
        const tags = props.tags
        if (Array.isArray(tags)) {
          for (const t of tags) {
            if (matchSpotlightTags.has(t)) return true
            if (activeCategories.has(t)) return true
          }
        }
        return false
      })

  if (activeFilters.size === 0) return pool
  return pool.filter(f => {
    const tags = f.properties?.tags
    if (!Array.isArray(tags)) return false
    for (const filt of activeFilters) {
      if (!tags.includes(filt)) return false
    }
    return true
  })
}

/**
 * Merge multiple FeatureCollections into one.
 * @param {...Object} fcs - GeoJSON FeatureCollections
 * @returns {Object} merged FeatureCollection
 */
export function mergeFeatureCollections(...fcs) {
  const features = []
  for (const fc of fcs) {
    if (fc?.features) features.push(...fc.features)
  }
  return { type: 'FeatureCollection', features }
}
