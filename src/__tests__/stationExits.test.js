import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  indexExitsByStation,
  exitsForStation,
  nearestExit,
  compassLabel,
  exitCode,
  exitBoundsWithMargin,
} from '../stationExits'

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 1, stationKey: '1,2-50', stationName: 'Westlake Station', name: 'Pine St', bearingFromStation: 10, accessible: true },
      geometry: { type: 'Point', coordinates: [-122.3370, 47.6120] },
    },
    {
      type: 'Feature',
      properties: { id: 2, stationKey: '1,2-50', stationName: 'Westlake Station', name: 'Olive Way', bearingFromStation: 200 },
      geometry: { type: 'Point', coordinates: [-122.3360, 47.6110] },
    },
    {
      type: 'Feature',
      properties: { id: 3, stationKey: '1-56', stationName: 'Beacon Hill Station', name: 'Beacon Ave', bearingFromStation: 90 },
      geometry: { type: 'Point', coordinates: [-122.3116, 47.5790] },
    },
  ],
}

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters([-122.33, 47.61], [-122.33, 47.61])).toBeLessThan(1e-6)
  })

  it('matches a known short distance within tolerance', () => {
    // ~0.001 deg of latitude ≈ 111 m.
    const m = haversineMeters([-122.33, 47.610], [-122.33, 47.611])
    expect(m).toBeGreaterThan(105)
    expect(m).toBeLessThan(118)
  })
})

describe('indexExitsByStation / exitsForStation', () => {
  it('groups exits by station key', () => {
    const index = indexExitsByStation(GEOJSON)
    expect(index.size).toBe(2)
    expect(exitsForStation(index, '1,2-50').length).toBe(2)
    expect(exitsForStation(index, '1-56').length).toBe(1)
  })

  it('flattens the feature into the UI shape', () => {
    const index = indexExitsByStation(GEOJSON)
    const exit = exitsForStation(index, '1,2-50')[0]
    expect(exit).toMatchObject({ id: 1, name: 'Pine St', bearing: 10, accessible: true })
    expect(exit.coordinates).toEqual([-122.3370, 47.6120])
  })

  it('returns an empty list for an unmapped station', () => {
    const index = indexExitsByStation(GEOJSON)
    expect(exitsForStation(index, '2-65')).toEqual([])
  })

  it('handles null/empty input', () => {
    expect(indexExitsByStation(null).size).toBe(0)
    expect(exitsForStation(null, '1,2-50')).toEqual([])
  })
})

describe('nearestExit', () => {
  it('picks the exit closest to the target by straight-line distance', () => {
    const exits = exitsForStation(indexExitsByStation(GEOJSON), '1,2-50')
    // A target right next to the Olive Way exit (id 2).
    const result = nearestExit(exits, [-122.3361, 47.6111])
    expect(result.exit.id).toBe(2)
    expect(result.meters).toBeLessThan(50)
  })

  it('returns null for an empty exit list', () => {
    expect(nearestExit([], [-122.33, 47.61])).toBeNull()
    expect(nearestExit(null, [-122.33, 47.61])).toBeNull()
  })
})

describe('compassLabel', () => {
  it('maps bearings to the nearest 8-point label', () => {
    expect(compassLabel(0)).toBe('N')
    expect(compassLabel(45)).toBe('NE')
    expect(compassLabel(90)).toBe('E')
    expect(compassLabel(180)).toBe('S')
    expect(compassLabel(270)).toBe('W')
    expect(compassLabel(359)).toBe('N')
  })

  it('returns empty for non-finite input', () => {
    expect(compassLabel(null)).toBe('')
    expect(compassLabel(Infinity)).toBe('')
  })
})

describe('exitCode', () => {
  it('extracts a ref from the name', () => {
    expect(exitCode({ name: 'Exit A1', bearing: 10 })).toBe('A1')
    expect(exitCode({ name: 'B', bearing: 200 })).toBe('B')
  })

  it('falls back to the compass direction', () => {
    expect(exitCode({ name: '5th Avenue & Pine St', bearing: 90 })).toBe('E')
    expect(exitCode({ name: '', bearing: 0 })).toBe('N')
  })
})

describe('exitBoundsWithMargin', () => {
  it('returns null for no exits', () => {
    expect(exitBoundsWithMargin([])).toBeNull()
    expect(exitBoundsWithMargin(null)).toBeNull()
  })

  it('expands the bounds by the margin around the center', () => {
    const exits = [
      { coordinates: [-122.34, 47.61] },
      { coordinates: [-122.32, 47.63] },
    ]
    // center (-122.33, 47.62), half-extent (0.01, 0.01) * 1.5 margin = 0.015.
    const [[minLng, minLat], [maxLng, maxLat]] = exitBoundsWithMargin(exits)
    expect(minLng).toBeCloseTo(-122.345, 6)
    expect(maxLng).toBeCloseTo(-122.315, 6)
    expect(minLat).toBeCloseTo(47.605, 6)
    expect(maxLat).toBeCloseTo(47.635, 6)
  })

  it('applies a minimum half-extent for a lone exit', () => {
    const [[minLng, minLat], [maxLng, maxLat]] = exitBoundsWithMargin(
      [{ coordinates: [-122.33, 47.62] }],
    )
    // half = max(0, 0.0008) * 1.5 = 0.0012.
    expect(maxLng - minLng).toBeCloseTo(0.0024, 6)
    expect(maxLat - minLat).toBeCloseTo(0.0024, 6)
  })
})
