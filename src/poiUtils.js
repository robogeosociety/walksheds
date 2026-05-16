/**
 * POI filtering utilities — point-in-polygon, tag aggregation, and filter logic.
 */

import { EVERYTHING_CATEGORY_ID } from './constants'

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
 * Additive filter: a POI is visible if it matches an enabled main category
 * (by `properties.category` or by tag membership) OR if any of its tags is
 * in the active tag filters. With nothing enabled and no active filters,
 * returns an empty array (additive default).
 *
 * The `everything` sentinel id (see EVERYTHING_CATEGORY_ID in constants)
 * short-circuits when present in enabledMainIds — all features pass.
 *
 * @param {Array} features - GeoJSON features
 * @param {Set<string>} enabledMainIds - main-category ids the user has activated
 * @param {Set<string>} activeTags - explicit tag filters
 * @param {Object} [mainCategoriesById] - map from id → { matchCategories[], matchTags[] }
 * @returns {Array} filtered features
 */
export function filterByMainCategoriesAndTags(features, enabledMainIds, activeTags, mainCategoriesById) {
  if (enabledMainIds && enabledMainIds.has(EVERYTHING_CATEGORY_ID)) return features
  const hasMain = enabledMainIds && enabledMainIds.size > 0
  const hasTags = activeTags && activeTags.size > 0
  if (!hasMain && !hasTags) return []

  const matchCats = new Set()
  const matchMainTags = new Set()
  if (hasMain && mainCategoriesById) {
    for (const id of enabledMainIds) {
      const cat = mainCategoriesById[id]
      if (!cat) continue
      for (const c of cat.matchCategories || []) matchCats.add(c)
      for (const t of cat.matchTags || []) matchMainTags.add(t)
    }
  }

  return features.filter(f => {
    const props = f.properties || {}
    const tags = props.tags
    if (hasMain) {
      if (props.category && matchCats.has(props.category)) return true
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (matchMainTags.has(t)) return true
        }
      }
    }
    if (hasTags && Array.isArray(tags)) {
      for (const t of tags) {
        if (activeTags.has(t)) return true
      }
    }
    return false
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
