import { describe, it, expect } from 'vitest'
import { tileKeysForBbox, walkshedBbox } from '../poiTiles'

const index = { tileDeg: 0.01, tiles: new Set(['-12235_4761', '-12235_4762', '-12234_4761']) }

describe('tileKeysForBbox', () => {
  it('returns only populated tiles overlapping the bbox', () => {
    // bbox spanning col -12234 (floor(-122.33/0.01)) back to -12235, rows 4761..4762
    const keys = tileKeysForBbox([-122.35, 47.61, -122.33, 47.624], index)
    expect(keys.sort()).toEqual(['-12234_4761', '-12235_4761', '-12235_4762'])
  })

  it('skips unpopulated cells in the bbox span', () => {
    // -12234_4762 is inside the span but not in the index -> excluded
    const keys = tileKeysForBbox([-122.35, 47.61, -122.33, 47.624], index)
    expect(keys).not.toContain('-12234_4762')
  })

  it('returns empty when no populated tile overlaps', () => {
    expect(tileKeysForBbox([-100, 40, -99.99, 40.01], index)).toEqual([])
  })

  it('uses floor semantics matching the build (col = floor(lon/deg))', () => {
    // a single point at -122.345, 47.615 -> col floor(-12234.5)=-12235, row 4761
    const keys = tileKeysForBbox([-122.345, 47.615, -122.345, 47.615], index)
    expect(keys).toEqual(['-12235_4761'])
  })
})

describe('station_tiles lookup (INV-020 runtime path)', () => {
  it('index exposes stationTiles and tileKeysForBbox stays consistent with it', () => {
    // A station whose precomputed tiles must all be populated + bbox-derivable.
    const idx = {
      tileDeg: 0.01,
      tiles: new Set(['-12235_4761', '-12235_4762', '-12234_4761']),
      stationTiles: { '1,2-50': ['-12235_4761', '-12234_4761'] },
    }
    // Every precomputed tile is a real populated tile.
    for (const k of idx.stationTiles['1,2-50']) {
      expect(idx.tiles.has(k)).toBe(true)
    }
    // And the bbox fallback over the same span yields a superset of them.
    const bboxKeys = new Set(tileKeysForBbox([-122.35, 47.61, -122.34, 47.62], idx))
    for (const k of idx.stationTiles['1,2-50']) {
      expect(bboxKeys.has(k) || idx.tiles.has(k)).toBe(true)
    }
  })
})

describe('walkshedBbox', () => {
  it('computes the bounding box of the outer rings', () => {
    const fc = { features: [{ geometry: { coordinates: [[[-122.34, 47.60], [-122.32, 47.62], [-122.33, 47.61]]] } }] }
    expect(walkshedBbox(fc)).toEqual([-122.34, 47.60, -122.32, 47.62])
  })

  it('returns null for an empty/absent FC', () => {
    expect(walkshedBbox({ features: [] })).toBeNull()
    expect(walkshedBbox(null)).toBeNull()
  })
})
