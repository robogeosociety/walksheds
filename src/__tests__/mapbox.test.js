import { describe, it, expect } from 'vitest'
import { computeSnapTarget } from '../mapbox'

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

  it('returns null when center is outside the largest enabled ring', () => {
    // [4, 0] sits outside the 15-min ring (half-width 3).
    expect(computeSnapTarget({
      mapCenter: [4, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })

  it('snaps to the station when inside the largest enabled ring and no popup is open', () => {
    // [2.5, 0] is outside the 5-min and 10-min rings but inside the 15-min.
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('snaps to the POI when a popup is open and center is inside the largest enabled ring', () => {
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: POI,
    })).toEqual([POI.longitude, POI.latitude])
  })

  it('uses only the largest enabled ring: dropping the outer ones shrinks the snap zone', () => {
    // With only the 5-min enabled (half-width 1), [2.5, 0] no longer snaps.
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: new Set([5]),
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
    // And [0.5, 0] (still inside the 5-min) does.
    expect(computeSnapTarget({
      mapCenter: [0.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: new Set([5]),
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('falls back to a smaller enabled ring when the largest hasn\'t loaded yet', () => {
    // 15-min ring missing from data; should fall back to 10-min for the test.
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
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
