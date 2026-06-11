import { describe, it, expect } from 'vitest'
import { haversineMeters, findNearestStation, MAX_SNAP_METERS } from '../locate'
import { computeCompassBearing } from '../useCompass'

const station = (name, lng, lat) => ({
  type: 'Feature',
  properties: { name, stopCode: 50, lines: '1,2', line: '1-line' },
  geometry: { type: 'Point', coordinates: [lng, lat] },
})

// Real coordinates: Westlake and Capitol Hill stations are ~1.5 km apart.
const WESTLAKE = station('Westlake Station', -122.33758, 47.61168)
const CAPITOL_HILL = station('Capitol Hill Station', -122.32028, 47.61918)
const ANGLE_LAKE = station('Angle Lake Station', -122.29761, 47.42229)

const STATIONS = { type: 'FeatureCollection', features: [WESTLAKE, CAPITOL_HILL, ANGLE_LAKE] }

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(-122.33, 47.6, -122.33, 47.6)).toBe(0)
  })

  it('matches the known Westlake to Capitol Hill distance (~1.5 km)', () => {
    const d = haversineMeters(-122.33758, 47.61168, -122.32028, 47.61918)
    expect(d).toBeGreaterThan(1400)
    expect(d).toBeLessThan(1700)
  })
})

describe('findNearestStation', () => {
  it('finds the closest station to a fix', () => {
    // Pike Place Market — closer to Westlake than Capitol Hill.
    const nearest = findNearestStation(STATIONS, -122.34053, 47.60972)
    expect(nearest.feature.properties.name).toBe('Westlake Station')
    expect(nearest.distanceMeters).toBeLessThan(MAX_SNAP_METERS)
  })

  it('reports distances beyond the snap threshold for out-of-corridor fixes', () => {
    // Bremerton, across Puget Sound.
    const nearest = findNearestStation(STATIONS, -122.62543, 47.56732)
    expect(nearest.distanceMeters).toBeGreaterThan(MAX_SNAP_METERS)
  })

  it('returns null without station data', () => {
    expect(findNearestStation(null, -122.33, 47.6)).toBeNull()
    expect(findNearestStation({ features: [] }, -122.33, 47.6)).toBeNull()
  })
})

describe('computeCompassBearing', () => {
  it('uses webkitCompassHeading when present (iOS)', () => {
    expect(computeCompassBearing({ webkitCompassHeading: 92.5, alpha: 10 })).toBe(92.5)
  })

  it('inverts absolute alpha to a clockwise compass heading', () => {
    expect(computeCompassBearing({ absolute: true, alpha: 90 })).toBe(270)
    expect(computeCompassBearing({ absolute: true, alpha: 0 })).toBe(0)
  })

  it('rejects non-absolute alpha readings and empty events', () => {
    expect(computeCompassBearing({ absolute: false, alpha: 90 })).toBeNull()
    expect(computeCompassBearing({})).toBeNull()
    expect(computeCompassBearing(null)).toBeNull()
  })
})
