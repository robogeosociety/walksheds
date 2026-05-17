import { describe, it, expect } from 'vitest'
import { computeSnapTarget } from '../mapbox'

// Square ring centered at [0, 0], half-width 1. Inside: |x| < 1 && |y| < 1.
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
    const target = computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: null,
      poiPopup: null,
    })
    expect(target).toBeNull()
  })

  it('returns null when center is outside every enabled walkshed', () => {
    // [10, 10] is well outside the 15-min ring (half-width 3).
    const target = computeSnapTarget({
      mapCenter: [10, 10],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })
    expect(target).toBeNull()
  })

  it('snaps to the station when inside the walkshed and no popup is open', () => {
    const target = computeSnapTarget({
      mapCenter: [0.5, 0.5],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })
    expect(target).toEqual([STATION.longitude, STATION.latitude])
  })

  it('snaps to the POI when a popup is open and center is inside the walkshed', () => {
    const target = computeSnapTarget({
      mapCenter: [0.5, 0.5],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: POI,
    })
    expect(target).toEqual([POI.longitude, POI.latitude])
  })

  it('uses the any-ring rule: inside the outer ring is enough even with all sizes enabled', () => {
    // Inside the 15-min ring (half-width 3) but outside the 5-min ring (half-width 1).
    const target = computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })
    expect(target).toEqual([STATION.longitude, STATION.latitude])
  })

  it('respects which walksheds are enabled', () => {
    // Center at [2.5, 0] is inside the 15-min ring but outside the 5-min ring.
    // With only the 5-min walkshed enabled, no snap.
    const target = computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      enabledWalksheds: new Set([5]),
      popup: STATION,
      poiPopup: null,
    })
    expect(target).toBeNull()
  })

  it('handles missing walkshed data for an enabled minute without throwing', () => {
    const target = computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: {},
      enabledWalksheds: ENABLED_ALL,
      popup: STATION,
      poiPopup: null,
    })
    expect(target).toBeNull()
  })
})
