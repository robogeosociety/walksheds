import { describe, it, expect } from 'vitest'
import {
  parseStationPath,
  buildStationPath,
  findStationByCode,
  parseWalkshedParams,
  buildWalkshedParams,
  combineQuery,
} from '../deepLink'

const BASE = '/walksheds/'

describe('parseStationPath', () => {
  it('parses valid line 1 path', () => {
    expect(parseStationPath('/walksheds/seattle/1/50', BASE))
      .toEqual({ system: 'seattle', line: '1', stopCode: 50 })
  })

  it('parses valid line 2 path', () => {
    expect(parseStationPath('/walksheds/seattle/2/54', BASE))
      .toEqual({ system: 'seattle', line: '2', stopCode: 54 })
  })

  it('handles trailing slash', () => {
    expect(parseStationPath('/walksheds/seattle/1/50/', BASE))
      .toEqual({ system: 'seattle', line: '1', stopCode: 50 })
  })

  it('returns null for unknown system', () => {
    expect(parseStationPath('/walksheds/portland/1/50', BASE)).toBeNull()
  })

  it('returns null for invalid line', () => {
    expect(parseStationPath('/walksheds/seattle/3/50', BASE)).toBeNull()
  })

  it('returns null for non-numeric stop code', () => {
    expect(parseStationPath('/walksheds/seattle/1/abc', BASE)).toBeNull()
  })

  it('returns null for too few segments', () => {
    expect(parseStationPath('/walksheds/', BASE)).toBeNull()
    expect(parseStationPath('/walksheds/seattle', BASE)).toBeNull()
  })

  it('returns null for too many segments', () => {
    expect(parseStationPath('/walksheds/seattle/1/50/extra', BASE)).toBeNull()
  })

  it('returns null for root path', () => {
    expect(parseStationPath('/walksheds/', BASE)).toBeNull()
  })

  it('accepts the legacy /{line}/{stopCode} form, defaulting to seattle', () => {
    // Shared URLs minted before the /seattle prefix existed should still
    // resolve. The app rewrites them to the new form on next replaceState.
    expect(parseStationPath('/walksheds/1/50', BASE))
      .toEqual({ system: 'seattle', line: '1', stopCode: 50 })
    expect(parseStationPath('/walksheds/2/54', BASE))
      .toEqual({ system: 'seattle', line: '2', stopCode: 54 })
  })
})

describe('buildStationPath', () => {
  it('builds the new /{system}/{line}/{stopCode} path', () => {
    expect(buildStationPath('1', 50, BASE)).toBe('/walksheds/seattle/1/50')
  })

  it('round-trips with parseStationPath', () => {
    const path = buildStationPath('2', 63, BASE)
    expect(parseStationPath(path, BASE)).toEqual({ system: 'seattle', line: '2', stopCode: 63 })
  })

  it('accepts an explicit system identifier', () => {
    expect(buildStationPath('1', 50, BASE, 'seattle')).toBe('/walksheds/seattle/1/50')
  })
})

const mockGeoJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Westlake Station', stopCode: 50, line: '1-line', shared: true, lines: '1,2' },
      geometry: { type: 'Point', coordinates: [-122.337, 47.612] },
    },
    {
      type: 'Feature',
      properties: { name: 'Stadium Station', stopCode: 54, line: '1-line', shared: false, lines: '1' },
      geometry: { type: 'Point', coordinates: [-122.327, 47.591] },
    },
    {
      type: 'Feature',
      properties: { name: 'Judkins Park Station', stopCode: 54, line: '2-line', shared: false, lines: '2' },
      geometry: { type: 'Point', coordinates: [-122.305, 47.590] },
    },
  ],
}

describe('findStationByCode', () => {
  it('finds shared station on line 1', () => {
    const result = findStationByCode(mockGeoJSON, '1', 50)
    expect(result).toEqual({ name: 'Westlake Station', lng: -122.337, lat: 47.612, line: '1-line' })
  })

  it('finds shared station on line 2', () => {
    const result = findStationByCode(mockGeoJSON, '2', 50)
    expect(result).toEqual({ name: 'Westlake Station', lng: -122.337, lat: 47.612, line: '2-line' })
  })

  it('finds line-exclusive station with correct line', () => {
    expect(findStationByCode(mockGeoJSON, '1', 54).name).toBe('Stadium Station')
    expect(findStationByCode(mockGeoJSON, '2', 54).name).toBe('Judkins Park Station')
  })

  it('returns null for wrong line on exclusive station', () => {
    expect(findStationByCode(mockGeoJSON, '2', 54)).not.toBeNull() // Judkins Park is on line 2
    // Stadium is only on line 1, code 54 on line 2 is Judkins Park
  })

  it('returns null for non-existent stop code', () => {
    expect(findStationByCode(mockGeoJSON, '1', 99)).toBeNull()
  })
})

describe('parseWalkshedParams', () => {
  it('returns null for empty search', () => {
    expect(parseWalkshedParams('')).toBeNull()
  })

  it('returns null for no walkshed params', () => {
    expect(parseWalkshedParams('?foo=bar')).toBeNull()
  })

  it('parses single walkshed', () => {
    const result = parseWalkshedParams('?walkshed=10')
    expect(result).toEqual(new Set([10]))
  })

  it('parses multiple walksheds', () => {
    const result = parseWalkshedParams('?walkshed=5&walkshed=15')
    expect(result).toEqual(new Set([5, 15]))
  })

  it('ignores invalid walkshed values', () => {
    expect(parseWalkshedParams('?walkshed=99')).toBeNull()
  })
})

describe('buildWalkshedParams', () => {
  it('returns empty for all enabled (default)', () => {
    expect(buildWalkshedParams(new Set([5, 10, 15]))).toBe('')
  })

  it('returns empty for none enabled', () => {
    expect(buildWalkshedParams(new Set())).toBe('')
  })

  it('builds params for subset', () => {
    expect(buildWalkshedParams(new Set([5, 10]))).toBe('?walkshed=5&walkshed=10')
  })

  it('builds params for single', () => {
    expect(buildWalkshedParams(new Set([15]))).toBe('?walkshed=15')
  })
})

describe('combineQuery', () => {
  it('returns empty string when all parts are empty', () => {
    expect(combineQuery('', '', '')).toBe('')
  })

  it('returns single part unchanged', () => {
    expect(combineQuery('?walkshed=5')).toBe('?walkshed=5')
  })

  it('skips empty parts', () => {
    expect(combineQuery('', '?pois=abc')).toBe('?pois=abc')
    expect(combineQuery('?walkshed=5', '')).toBe('?walkshed=5')
  })

  it('joins multiple parts with single ? prefix', () => {
    expect(combineQuery('?walkshed=5', '?pois=abc')).toBe('?walkshed=5&pois=abc')
  })

  it('handles parts without leading ?', () => {
    expect(combineQuery('walkshed=5', 'pois=abc')).toBe('?walkshed=5&pois=abc')
  })
})
