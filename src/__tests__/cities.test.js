import { describe, it, expect } from 'vitest'
import {
  CITIES, CITY_SLUGS, DEFAULT_CITY_SLUG, CAP_EXITS, CAP_POIS, CAP_WALKSHEDS,
  cityBySlug, isCitySlug, hasCapability, cityAsset, lineByKey, lineColors,
  resolveCity, rememberCity, validLineValues, walkshedAccent,
} from '../cities'

function fakeStorage(initial = {}) {
  const store = { ...initial }
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    _store: store,
  }
}

describe('city registry', () => {
  it('ships both cities with the default first-class', () => {
    expect(CITY_SLUGS).toContain('seattle')
    expect(CITY_SLUGS).toContain('honolulu')
    expect(isCitySlug(DEFAULT_CITY_SLUG)).toBe(true)
  })

  it('falls back to the default for an unknown slug', () => {
    expect(cityBySlug('atlantis').slug).toBe(DEFAULT_CITY_SLUG)
    expect(isCitySlug('atlantis')).toBe(false)
  })

  it('never declares pois without walksheds', () => {
    // POI membership is defined by the isochrones, so the pair is not optional.
    for (const c of CITIES) {
      if (hasCapability(c, CAP_POIS)) expect(hasCapability(c, CAP_WALKSHEDS)).toBe(true)
    }
  })

  it('reports Honolulu as rail-and-exits only', () => {
    const honolulu = cityBySlug('honolulu')
    expect(hasCapability(honolulu, CAP_EXITS)).toBe(true)
    expect(hasCapability(honolulu, CAP_WALKSHEDS)).toBe(false)
    expect(hasCapability(honolulu, CAP_POIS)).toBe(false)
  })

  it('scopes assets under the city', () => {
    expect(cityAsset(cityBySlug('honolulu'), 'all-stations.geojson'))
      .toContain('cities/honolulu/all-stations.geojson')
  })
})

describe('lines', () => {
  it('maps a station lines key to its line', () => {
    expect(lineByKey(cityBySlug('seattle'), '2').label).toBe('2 Line')
    expect(lineByKey(cityBySlug('honolulu'), '1').glyph).toBe('S')
    expect(lineByKey(cityBySlug('honolulu'), '2')).toBeNull()
  })

  it('enumerates the lines values a station may carry', () => {
    expect([...validLineValues(cityBySlug('seattle'))].sort()).toEqual(['1', '1,2', '2'])
    expect([...validLineValues(cityBySlug('honolulu'))]).toEqual(['1'])
  })

  it('resolves colors per mode', () => {
    const honolulu = cityBySlug('honolulu')
    const light = lineColors(honolulu, false)['1-line']
    const dark = lineColors(honolulu, true)['1-line']
    // Skyline's registered route color is very dark, so dark mode lightens it
    // rather than losing the line against the dusk basemap.
    expect(dark.color).not.toBe(light.color)
    expect(walkshedAccent(honolulu, true)).not.toBe(walkshedAccent(honolulu, false))
  })

  it('keeps Seattle\'s walkshed accent identical in both modes', () => {
    // WalkshedLayers always drew the light accent; this preserves that exactly.
    const seattle = cityBySlug('seattle')
    expect(walkshedAccent(seattle, true)).toBe(walkshedAccent(seattle, false))
  })
})

describe('resolveCity precedence', () => {
  it('prefers an explicit ?city= over stored state', () => {
    const storage = fakeStorage({ walksheds_city: 'seattle' })
    expect(resolveCity({ search: '?city=honolulu', storage }).slug).toBe('honolulu')
  })

  it('ignores an unknown ?city= and falls through', () => {
    const storage = fakeStorage({ walksheds_city: 'honolulu' })
    expect(resolveCity({ search: '?city=atlantis', storage }).slug).toBe('honolulu')
  })

  it('uses stored state when no param is given', () => {
    const storage = fakeStorage({ walksheds_city: 'honolulu' })
    expect(resolveCity({ search: '', storage }).slug).toBe('honolulu')
  })

  it('defaults when there is neither', () => {
    expect(resolveCity({ search: '', storage: null }).slug).toBe(DEFAULT_CITY_SLUG)
  })

  it('ignores storage entirely when none is passed (embed mode)', () => {
    const storage = fakeStorage({ walksheds_city: 'honolulu' })
    expect(resolveCity({ search: '', storage: null }).slug).toBe(DEFAULT_CITY_SLUG)
    expect(storage._store.walksheds_city).toBe('honolulu')
  })

  it('remembers only real slugs', () => {
    const storage = fakeStorage()
    rememberCity('honolulu', storage)
    expect(storage._store.walksheds_city).toBe('honolulu')
    rememberCity('atlantis', storage)
    expect(storage._store.walksheds_city).toBe('honolulu')
  })
})
