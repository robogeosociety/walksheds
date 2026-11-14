import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadPoisForWalkshed, loadTileIndex, orderTilesByDistance, streamPoisForWalkshed, tileKeysForBbox, walkshedBbox } from '../poiTiles'

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

describe('loadPoisForWalkshed fetch paths', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  // Regression: after the multi-city move the index loaded from the city root
  // but tiles were fetched from the site root, 404ed, and silently resolved
  // to [] -- every walkshed showed zero POIs.
  it('fetches tiles from the same city data root as the index', async () => {
    const poi = { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [-122.345, 47.615] } }
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/cities/testcity/pois/tiles/index.json') {
        return { ok: true, json: async () => ({ tile_deg: 0.01, count: 1, tiles: ['-12235_4761'], station_tiles: { '1-50': ['-12235_4761'] } }) }
      }
      if (url === '/cities/testcity/pois/tiles/-12235_4761.geojson') {
        return { ok: true, json: async () => ({ features: [poi] }) }
      }
      return { ok: false, json: async () => ({}) }
    })

    const index = await loadTileIndex('/cities/testcity/')
    expect(index.base).toBe('/cities/testcity/')
    const walkshed = { features: [{ geometry: { coordinates: [[[-122.35, 47.61], [-122.34, 47.61], [-122.34, 47.62]]] } }] }

    expect(await loadPoisForWalkshed(walkshed, index, '1-50')).toEqual([poi])
    const urls = globalThis.fetch.mock.calls.map(c => String(c[0]))
    expect(urls.every(u => u.startsWith('/cities/testcity/pois/tiles/'))).toBe(true)
  })
})

describe('orderTilesByDistance', () => {
  const idx = { tileDeg: 0.01 }

  it('puts the cell containing the centre first, then its neighbours', () => {
    // centre -122.335, 47.615 sits in cell -12234_4761
    const keys = ['-12236_4763', '-12234_4761', '-12235_4761', '-12234_4762']
    const ordered = orderTilesByDistance(keys, idx, [-122.335, 47.615])
    expect(ordered[0]).toBe('-12234_4761')
    expect(ordered.at(-1)).toBe('-12236_4763')
  })

  it('scales longitude by latitude, so a column step is shorter than a row step up north', () => {
    // At 47.6 N a 0.01 deg column step (~750 m) is nearer than a 0.01 deg row step (~1,110 m).
    const ordered = orderTilesByDistance(['-12234_4762', '-12235_4761'], idx, [-122.335, 47.615])
    expect(ordered).toEqual(['-12235_4761', '-12234_4762'])
  })

  it('does not mutate its input', () => {
    const keys = ['-12233_4761', '-12234_4761']
    const copy = [...keys]
    orderTilesByDistance(keys, idx, [-122.335, 47.615])
    expect(keys).toEqual(copy)
  })
})

describe('streamPoisForWalkshed', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  const feat = (id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [0, 0] } })

  it('hands each tile to onTile as it lands, nearest requested first, and resolves to all of them', async () => {
    const releases = {}
    globalThis.fetch = vi.fn((url) => new Promise((resolve) => {
      const key = url.match(/tiles\/(.+)\.geojson$/)[1]
      releases[key] = () => resolve({ ok: true, json: async () => ({ features: [feat(key)] }) })
    }))
    const index = {
      base: '/cities/stream1/', tileDeg: 0.01,
      tiles: new Set(['-12236_4763', '-12234_4761']),
      stationTiles: { 's-1': ['-12236_4763', '-12234_4761'] },
    }
    const seen = []
    const done = streamPoisForWalkshed(null, index, 's-1', {
      center: [-122.335, 47.615],
      onTile: (features, key) => seen.push([key, features.length]),
    })
    // Nearest tile requested first.
    expect(globalThis.fetch.mock.calls.map(c => c[0])).toEqual([
      '/cities/stream1/pois/tiles/-12234_4761.geojson',
      '/cities/stream1/pois/tiles/-12236_4763.geojson',
    ])
    // The far tile landing first is delivered first: completion order, not request order.
    releases['-12236_4763']()
    await new Promise(r => setTimeout(r, 0))
    expect(seen).toEqual([['-12236_4763', 1]])
    releases['-12234_4761']()
    const all = await done
    expect(seen.map(s => s[0])).toEqual(['-12236_4763', '-12234_4761'])
    expect(all.map(f => f.properties.id).sort()).toEqual(['-12234_4761', '-12236_4763'])
  })

  it('passes a fetch priority through for prefetches', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }))
    const index = { base: '/cities/stream2/', tileDeg: 0.01, tiles: new Set(['1_1']), stationTiles: { k: ['1_1'] } }
    await streamPoisForWalkshed(null, index, 'k', { priority: 'low' })
    expect(globalThis.fetch).toHaveBeenCalledWith('/cities/stream2/pois/tiles/1_1.geojson', { priority: 'low' })
  })
})
