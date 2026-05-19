import { describe, it, expect } from 'vitest'
import {
  pointInPolygon,
  filterPOIsInWalkshed,
  getAvailableTags,
  filterByTags,
  filterByCategoriesAndFilters,
  mergeFeatureCollections,
} from '../poiUtils'

// Simple square polygon: (0,0) → (10,0) → (10,10) → (0,10) → (0,0)
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]

function makeFeature(lng, lat, props = {}) {
  return {
    type: 'Feature',
    properties: { name: 'Test', category: 'restaurant', tags: ['test'], ...props },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

function makeFC(features) {
  return { type: 'FeatureCollection', features }
}

function makeWalkshed(ring) {
  return makeFC([{
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }])
}

describe('pointInPolygon', () => {
  it('returns true for a point inside the polygon', () => {
    expect(pointInPolygon([5, 5], SQUARE)).toBe(true)
  })

  it('returns true for a point near a corner but inside', () => {
    expect(pointInPolygon([1, 1], SQUARE)).toBe(true)
  })

  it('returns false for a point outside the polygon', () => {
    expect(pointInPolygon([15, 5], SQUARE)).toBe(false)
  })

  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon([-5, -5], SQUARE)).toBe(false)
  })

  it('works with a triangle', () => {
    const triangle = [[0, 0], [10, 0], [5, 10], [0, 0]]
    expect(pointInPolygon([5, 3], triangle)).toBe(true)
    expect(pointInPolygon([9, 8], triangle)).toBe(false)
  })

  it('works with real-world coordinates near Judkins Park', () => {
    // Simplified walkshed-like polygon around Judkins Park
    const ring = [
      [-122.31, 47.585],
      [-122.30, 47.585],
      [-122.30, 47.595],
      [-122.31, 47.595],
      [-122.31, 47.585],
    ]
    // Judkins Park station: -122.3045, 47.5903
    expect(pointInPolygon([-122.3045, 47.5903], ring)).toBe(true)
    // Far away point
    expect(pointInPolygon([-122.33, 47.61], ring)).toBe(false)
  })
})

describe('filterPOIsInWalkshed', () => {
  const walkshed = makeWalkshed(SQUARE)

  it('keeps features inside the walkshed', () => {
    const pois = makeFC([makeFeature(5, 5), makeFeature(15, 5)])
    const result = filterPOIsInWalkshed(pois, walkshed)
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([5, 5])
  })

  it('returns empty FC when no walkshed', () => {
    const pois = makeFC([makeFeature(5, 5)])
    const result = filterPOIsInWalkshed(pois, null)
    expect(result.features).toHaveLength(0)
  })

  it('returns empty FC when walkshed has no features', () => {
    const pois = makeFC([makeFeature(5, 5)])
    const result = filterPOIsInWalkshed(pois, makeFC([]))
    expect(result.features).toHaveLength(0)
  })

  it('returns empty FC when POI FC is null', () => {
    const result = filterPOIsInWalkshed(null, walkshed)
    expect(result.features).toHaveLength(0)
  })

  it('preserves all feature properties', () => {
    const pois = makeFC([makeFeature(5, 5, { name: 'Pizza Place', tags: ['pizza'] })])
    const result = filterPOIsInWalkshed(pois, walkshed)
    expect(result.features[0].properties.name).toBe('Pizza Place')
    expect(result.features[0].properties.tags).toEqual(['pizza'])
  })
})

describe('getAvailableTags', () => {
  it('counts tags across features', () => {
    const features = [
      makeFeature(0, 0, { tags: ['pizza', 'italian'] }),
      makeFeature(0, 0, { tags: ['pizza', 'outdoor-seating'] }),
      makeFeature(0, 0, { tags: ['sushi', 'japanese'] }),
    ]
    const tags = getAvailableTags(features)
    expect(tags[0]).toEqual({ tag: 'pizza', count: 2, color: null })
    expect(tags).toHaveLength(5)
  })

  it('sorts by count descending, then alphabetically', () => {
    const features = [
      makeFeature(0, 0, { tags: ['b', 'a'] }),
      makeFeature(0, 0, { tags: ['a', 'c'] }),
    ]
    const tags = getAvailableTags(features)
    expect(tags[0]).toEqual({ tag: 'a', count: 2, color: null })
    expect(tags[1].tag).toBe('b')
    expect(tags[2].tag).toBe('c')
  })

  it('returns empty array for no features', () => {
    expect(getAvailableTags([])).toEqual([])
  })

  it('skips features without tags', () => {
    const features = [
      makeFeature(0, 0, { tags: ['a'] }),
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ]
    const tags = getAvailableTags(features)
    expect(tags).toEqual([{ tag: 'a', count: 1, color: null }])
  })

  it('returns color from tagColors map when present', () => {
    const features = [
      makeFeature(0, 0, { tags: ['pizza'] }),
      makeFeature(0, 0, { tags: ['pizza', 'wifi'] }),
    ]
    const tagColors = { pizza: '#E67E22', wifi: '#34495E' }
    const tags = getAvailableTags(features, tagColors)
    const byTag = Object.fromEntries(tags.map(t => [t.tag, t]))
    expect(byTag.pizza.color).toBe('#E67E22')
    expect(byTag.wifi.color).toBe('#34495E')
  })

  it('returns null color when tag is not in tagColors', () => {
    const features = [makeFeature(0, 0, { tags: ['pizza'] })]
    const tags = getAvailableTags(features, { sushi: '#000' })
    expect(tags[0].color).toBeNull()
  })

  it('handles missing tagColors gracefully', () => {
    const features = [makeFeature(0, 0, { tags: ['pizza'] })]
    const tags = getAvailableTags(features)
    expect(tags[0].color).toBeNull()
  })
})

describe('filterByTags', () => {
  const features = [
    makeFeature(0, 0, { tags: ['pizza', 'italian', 'outdoor-seating'] }),
    makeFeature(0, 0, { tags: ['pizza', 'vegan'] }),
    makeFeature(0, 0, { tags: ['sushi', 'japanese'] }),
  ]

  it('returns all features when no active tags', () => {
    expect(filterByTags(features, new Set())).toHaveLength(3)
    expect(filterByTags(features, null)).toHaveLength(3)
  })

  it('filters by a single tag', () => {
    const result = filterByTags(features, new Set(['pizza']))
    expect(result).toHaveLength(2)
  })

  it('uses OR logic for multiple tags', () => {
    const result = filterByTags(features, new Set(['pizza', 'italian']))
    expect(result).toHaveLength(2) // both pizza features match
  })

  it('returns features matching any of the tags', () => {
    const result = filterByTags(features, new Set(['pizza', 'sushi']))
    expect(result).toHaveLength(3) // all three match at least one tag
  })

  it('handles features without tags array', () => {
    const mixed = [
      ...features,
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
    ]
    const result = filterByTags(mixed, new Set(['pizza']))
    expect(result).toHaveLength(2)
  })
})

describe('filterByCategoriesAndFilters', () => {
  // Each feature listed with a comment of its (category, tags) so the
  // expectations stay readable.
  const features = [
    makeFeature(0, 0, { category: 'restaurant', tags: ['pizza', 'italian', 'wheelchair-accessible'] }), // 0
    makeFeature(0, 0, { category: 'fast_food',  tags: ['burger', 'child-friendly'] }),                  // 1
    makeFeature(0, 0, { category: 'cafe',       tags: ['wifi'] }),                                      // 2
    makeFeature(0, 0, { category: 'bar',        tags: ['outdoor-seating'] }),                           // 3
    makeFeature(0, 0, { category: 'restaurant', tags: ['brewery', 'child-friendly'] }),                 // 4
    makeFeature(0, 0, { category: 'park',       tags: ['dog-friendly'] }),                              // 5
    makeFeature(0, 0, { category: 'museum',     tags: ['art', 'wheelchair-accessible'] }),              // 6
  ]
  const spotlightsById = {
    everything:  { matchAll: true },
    restaurants: { matchCategories: ['restaurant', 'fast_food', 'ice_cream', 'bakery'], matchTags: [] },
    bars:        { matchCategories: ['bar', 'pub'], matchTags: ['brewery', 'winery', 'distillery', 'has-bar'] },
    coffee:      { matchCategories: ['cafe'], matchTags: ['coffee', 'coffee-shop', 'coffee-roaster'] },
    parks:       { matchCategories: ['park', 'playground', 'garden'], matchTags: [] },
  }
  // Shorthand for the three independent inputs — matches the truth table
  // in README.md → "POI selection logic".
  const opts = (spots = [], cats = [], filts = []) => ({
    enabledSpotlights: new Set(spots),
    activeCategories: new Set(cats),
    activeFilters: new Set(filts),
    spotlightsById,
  })

  it('returns empty array when nothing is enabled or active', () => {
    expect(filterByCategoriesAndFilters(features, opts())).toEqual([])
  })

  it('filter-only with no category pool returns empty (no pool to filter)', () => {
    expect(filterByCategoriesAndFilters(features, opts([], [], ['child-friendly']))).toEqual([])
  })

  it('spotlight match: features in restaurants spotlight', () => {
    const r = filterByCategoriesAndFilters(features, opts(['restaurants']))
    // 0 pizza + 1 burger + 4 brewery
    expect(r).toHaveLength(3)
  })

  it('spotlight matchTags: brewery → bars', () => {
    const r = filterByCategoriesAndFilters(features, opts(['bars']))
    // 3 outdoor-seating bar + 4 brewery
    expect(r).toHaveLength(2)
  })

  it('multiple spotlights union together', () => {
    const r = filterByCategoriesAndFilters(features, opts(['coffee', 'parks']))
    // 2 cafe wifi + 5 park
    expect(r).toHaveLength(2)
  })

  it('activeCategories union with spotlights', () => {
    const r = filterByCategoriesAndFilters(features, opts(['parks'], ['art']))
    // park + museum (art tag)
    expect(r).toHaveLength(2)
  })

  it('activeCategories alone (no spotlight)', () => {
    const r = filterByCategoriesAndFilters(features, opts([], ['pizza', 'art']))
    expect(r).toHaveLength(2)
  })

  it('activeFilters AND on top of spotlight pool', () => {
    // restaurants pool = [0,1,4]; filter child-friendly → only [1,4]
    const r = filterByCategoriesAndFilters(features, opts(['restaurants'], [], ['child-friendly']))
    expect(r).toHaveLength(2)
  })

  it('multiple activeFilters AND across the set', () => {
    // restaurants pool = [0,1,4]; child-friendly ∩ wheelchair-accessible → ∅
    const r = filterByCategoriesAndFilters(
      features, opts(['restaurants'], [], ['child-friendly', 'wheelchair-accessible']),
    )
    expect(r).toHaveLength(0)
  })

  it('matchAll spotlight short-circuits the pool to every feature', () => {
    const r = filterByCategoriesAndFilters(features, opts(['everything']))
    expect(r).toHaveLength(features.length)
  })

  it('matchAll still respects activeFilters (AND on top)', () => {
    const r = filterByCategoriesAndFilters(features, opts(['everything'], [], ['wheelchair-accessible']))
    // 0 (restaurant) + 6 (museum)
    expect(r).toHaveLength(2)
  })

  it('matchAll combined with other spotlights stays matchAll', () => {
    const r = filterByCategoriesAndFilters(features, opts(['everything', 'parks']))
    expect(r).toHaveLength(features.length)
  })

  it('handles features with no tags array', () => {
    const mixed = [...features, {
      type: 'Feature',
      properties: { category: 'restaurant' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    }]
    const r = filterByCategoriesAndFilters(mixed, opts(['restaurants']))
    expect(r).toHaveLength(4)
  })

  it('ignores non-matching categories', () => {
    const r = filterByCategoriesAndFilters(features, opts(['restaurants']))
    expect(r.every(f => ['restaurant', 'fast_food'].includes(f.properties.category))).toBe(true)
  })
})

describe('mergeFeatureCollections', () => {
  it('merges multiple FCs', () => {
    const fc1 = makeFC([makeFeature(1, 1)])
    const fc2 = makeFC([makeFeature(2, 2), makeFeature(3, 3)])
    const result = mergeFeatureCollections(fc1, fc2)
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(3)
  })

  it('handles null/undefined inputs', () => {
    const fc1 = makeFC([makeFeature(1, 1)])
    const result = mergeFeatureCollections(fc1, null, undefined)
    expect(result.features).toHaveLength(1)
  })

  it('returns empty FC for no inputs', () => {
    const result = mergeFeatureCollections()
    expect(result.features).toHaveLength(0)
  })
})
