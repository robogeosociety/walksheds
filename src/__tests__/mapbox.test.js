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
// The helper fixes its boundary at the 10-min ring regardless of which
// walksheds are toggled on for display, so the test fixture only needs to
// vary the 10-min ring's size.
const WALKSHEDS = {
  5: fcFromRing(squareRing(0, 0, 1)),
  10: fcFromRing(squareRing(0, 0, 2)),
  15: fcFromRing(squareRing(0, 0, 3)),
}

describe('computeSnapTarget', () => {
  it('returns null when no station is selected', () => {
    expect(computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: WALKSHEDS,
      popup: null,
      poiPopup: null,
    })).toBeNull()
  })

  it('returns null when center is outside the 10-min ring', () => {
    expect(computeSnapTarget({
      mapCenter: [2.5, 0],
      walksheds: WALKSHEDS,
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })

  it('snaps to the station when inside the 10-min ring and no popup is open', () => {
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
      walksheds: WALKSHEDS,
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('snaps to the POI when a popup is open and center is inside the 10-min ring', () => {
    expect(computeSnapTarget({
      mapCenter: [0.5, 0.5],
      walksheds: WALKSHEDS,
      popup: STATION,
      poiPopup: POI,
    })).toEqual([POI.longitude, POI.latitude])
  })

  it('still snaps when only the 10-min ring is loaded (others irrelevant)', () => {
    expect(computeSnapTarget({
      mapCenter: [1.5, 0],
      walksheds: { 10: WALKSHEDS[10] },
      popup: STATION,
      poiPopup: null,
    })).toEqual([STATION.longitude, STATION.latitude])
  })

  it('returns null when the 10-min ring hasn\'t loaded yet', () => {
    expect(computeSnapTarget({
      mapCenter: [0, 0],
      walksheds: { 5: WALKSHEDS[5], 15: WALKSHEDS[15] },
      popup: STATION,
      poiPopup: null,
    })).toBeNull()
  })
})
