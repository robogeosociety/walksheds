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
