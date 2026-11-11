import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeSnapTarget, fetchWalkshed } from '../mapbox'

// Square ring centered at [cx, cy] with half-width `half`. Inside ⇔ |x - cx| < half && |y - cy| < half.
function squareRing(cx, cy, half) {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
    [cx - half, cy - half],
  ]
}

function fcFromRing(ring) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }],
  }
}

const STATION = { longitude: 0, latitude: 0 }
const POI = { longitude: 0.3, latitude: 0.3 }
const WALKSHEDS = {
  5: fcFromRing(squareRing(0, 0, 1)),
  10: fcFromRing(squareRing(0, 0, 2)),
  15: fcFromRing(squareRing(0, 0, 3)),
}
const ENABLED_ALL = new Set([5, 10, 15])

describe('computeSnapTarget', () => {
  it('returns null when no station is selected', () => {
    expect(computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: null,
      poiPopup: null,
    })).toBeNull()
  })

  it('returns null when center is outside the snap (n-1) ring', () => {
    // [2.5, 0] sits inside the 15-min ring but outside the 10-min snap ring.
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })

  it('snaps to the station when inside the n-1 enabled ring and no popup is open', () => {
    // [1.5, 0] is outside the 5-min but inside the 10-min snap ring.
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('snaps to the POI when a popup is open and center is inside the n-1 ring', () => {
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: POI,
    })).toEqual([POI.longitude, POI.latitude])
  })

  it('uses the only enabled ring when just one is on (no n-1 fallback exists)', () => {
    // With only the 5-min enabled (half-width 1), [0.5, 0] snaps.
    expect(computeSnapTarget({
      mapCenter: [0.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: new Set([5]),
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
    // And [2.5, 0] (outside the 5-min) does not.
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: new Set([5]),
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })

  it('snap zone tracks the n-1 of loaded rings: dropping the 15-min loaded data makes 5-min the snap', () => {
    // With only {5, 10} loaded and ENABLED_ALL, the n-1 of loaded becomes the 5-min ring.
    // [1.5, 0] is outside the 5-min snap → null.
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
      walksheds: { 5: WALKSHEDS[5], 10: WALKSHEDS[10] },
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
    // [0.5, 0] (inside 5-min) snaps.
    expect(computeSnapTarget({
      mapCenter: [0.5, 0],
      walksheds: { 5: WALKSHEDS[5], 10: WALKSHEDS[10] },
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('returns null when no enabled ring has loaded yet', () => {
    expect(computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: {},
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })
})

describe('fetchWalkshed sources', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  const fc = (tag) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { tag }, geometry: null }] })

  it('serves the committed polygon without calling the Isochrone API', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/cities/t1/walksheds.json') {
        return { ok: true, json: async () => ({ walksheds: { '1,2-50': { 10: fc('committed') } } }) }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const got = await fetchWalkshed(-122.3, 47.6, 10, { setUrl: '/cities/t1/walksheds.json', stationKey: '1,2-50' })
    expect(got.features[0].properties.tag).toBe('committed')
    expect(globalThis.fetch.mock.calls.map(c => c[0])).toEqual(['/cities/t1/walksheds.json'])
  })

  it('loads a city set once for every station and contour', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ walksheds: { 'a-1': { 5: fc('a5'), 15: fc('a15') }, 'b-2': { 5: fc('b5') } } }),
    }))
    const setUrl = '/cities/t2/walksheds.json'
    await Promise.all([
      fetchWalkshed(0, 0, 5, { setUrl, stationKey: 'a-1' }),
      fetchWalkshed(0, 0, 15, { setUrl, stationKey: 'a-1' }),
      fetchWalkshed(1, 1, 5, { setUrl, stationKey: 'b-2' }),
    ])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the live API for a station the set lacks', async () => {
    globalThis.fetch = vi.fn(async (url) => (url.startsWith('https://api.mapbox.com/isochrone/')
      ? { ok: true, json: async () => fc('live') }
      : { ok: true, json: async () => ({ walksheds: {} }) }))
    const got = await fetchWalkshed(-157.9, 21.4, 5, { setUrl: '/cities/t3/walksheds.json', stationKey: '1-99' })
    expect(got.features[0].properties.tag).toBe('live')
  })
})
