import { describe, it, expect, vi } from 'vitest'
import { buildPoiFilterParam, parsePoiFilterParam } from '../poiFilterUrl'

const SCHEMA = {
  hash: 'a3f2c1b9',
  main_categories: ['restaurants', 'bars', 'coffee', 'parks'],
  tags: ['coffee-shop', 'pizza', 'vegan', 'wheelchair-accessible'],
}

describe('buildPoiFilterParam', () => {
  it('returns empty string for empty filter state', () => {
    expect(buildPoiFilterParam(new Set(), new Set(), SCHEMA)).toBe('')
  })

  it('returns empty string when schema is missing', () => {
    expect(buildPoiFilterParam(new Set(['restaurants']), new Set(['pizza']), null)).toBe('')
  })

  it('encodes only categories when no tags are selected', () => {
    expect(buildPoiFilterParam(new Set(['restaurants', 'bars']), new Set(), SCHEMA))
      .toBe('?pois=a3f2c1b9~c.restaurants.bars')
  })

  it('encodes only tags when no categories are selected', () => {
    expect(buildPoiFilterParam(new Set(), new Set(['pizza', 'vegan']), SCHEMA))
      .toBe('?pois=a3f2c1b9~t.pizza.vegan')
  })

  it('encodes both categories and tags', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars']),
      new Set(['pizza', 'wheelchair-accessible']),
      SCHEMA,
    )
    expect(out).toBe('?pois=a3f2c1b9~c.restaurants.bars~t.pizza.wheelchair-accessible')
  })

  it('preserves schema-defined order regardless of insertion order', () => {
    const out = buildPoiFilterParam(
      new Set(['parks', 'restaurants']),
      new Set(['vegan', 'pizza']),
      SCHEMA,
    )
    expect(out).toBe('?pois=a3f2c1b9~c.restaurants.parks~t.pizza.vegan')
  })

  it('drops names not in the schema', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'unknown-cat']),
      new Set(['pizza', 'unknown-tag']),
      SCHEMA,
    )
    expect(out).toBe('?pois=a3f2c1b9~c.restaurants~t.pizza')
  })

  it('uses only URL-unreserved characters', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars', 'coffee', 'parks']),
      new Set(['coffee-shop', 'pizza', 'vegan', 'wheelchair-accessible']),
      SCHEMA,
    )
    expect(out.slice(1)).toMatch(/^[a-zA-Z0-9.~=-]+$/)
  })

  it('returns empty string when state matches the supplied defaults', () => {
    const defaults = ['parks', 'coffee']
    expect(buildPoiFilterParam(new Set(['parks', 'coffee']), new Set(), SCHEMA, defaults)).toBe('')
    // Insertion order should not matter
    expect(buildPoiFilterParam(new Set(['coffee', 'parks']), new Set(), SCHEMA, defaults)).toBe('')
  })

  it('encodes when categories diverge from defaults', () => {
    const defaults = ['parks', 'coffee']
    const out = buildPoiFilterParam(new Set(['parks']), new Set(), SCHEMA, defaults)
    expect(out).toBe('?pois=a3f2c1b9~c.parks')
  })

  it('encodes when defaults are present but tags are also selected', () => {
    const defaults = ['parks', 'coffee']
    const out = buildPoiFilterParam(new Set(['parks', 'coffee']), new Set(['pizza']), SCHEMA, defaults)
    expect(out).toBe('?pois=a3f2c1b9~c.coffee.parks~t.pizza')
  })
})

describe('parsePoiFilterParam', () => {
  it('returns null when search is empty', () => {
    expect(parsePoiFilterParam('', SCHEMA)).toBeNull()
  })

  it('returns null when no pois param is present', () => {
    expect(parsePoiFilterParam('?walkshed=10', SCHEMA)).toBeNull()
  })

  it('returns null when schema is missing', () => {
    expect(parsePoiFilterParam('?pois=a3f2c1b9~c.restaurants', null)).toBeNull()
  })

  it('round-trips categories', () => {
    const cats = new Set(['restaurants', 'bars'])
    const tags = new Set()
    const url = buildPoiFilterParam(cats, tags, SCHEMA)
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(parsed.categories).toEqual(cats)
    expect(parsed.tags.size).toBe(0)
  })

  it('round-trips tags', () => {
    const cats = new Set()
    const tags = new Set(['pizza', 'vegan'])
    const url = buildPoiFilterParam(cats, tags, SCHEMA)
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(parsed.categories.size).toBe(0)
    expect(parsed.tags).toEqual(tags)
  })

  it('round-trips combined state', () => {
    const cats = new Set(['restaurants', 'parks'])
    const tags = new Set(['pizza', 'wheelchair-accessible'])
    const url = buildPoiFilterParam(cats, tags, SCHEMA)
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(parsed.categories).toEqual(cats)
    expect(parsed.tags).toEqual(tags)
  })

  it('drops unknown tags silently', () => {
    const url = '?pois=a3f2c1b9~t.pizza.zzz-not-real'
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(parsed.tags).toEqual(new Set(['pizza']))
  })

  it('drops unknown categories silently', () => {
    const url = '?pois=a3f2c1b9~c.restaurants.bogus'
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(parsed.categories).toEqual(new Set(['restaurants']))
  })

  it('warns but still decodes on hash mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = '?pois=deadbeef~c.restaurants~t.pizza'
    const parsed = parsePoiFilterParam(url, SCHEMA)
    expect(warn).toHaveBeenCalled()
    expect(parsed.categories).toEqual(new Set(['restaurants']))
    expect(parsed.tags).toEqual(new Set(['pizza']))
    warn.mockRestore()
  })

  it('returns null for garbage param values', () => {
    expect(parsePoiFilterParam('?pois=garbage', SCHEMA)).toBeNull()
  })

  it('survives malformed sections without throwing', () => {
    expect(() => parsePoiFilterParam('?pois=a3f2c1b9~~c.~t.', SCHEMA)).not.toThrow()
    expect(parsePoiFilterParam('?pois=a3f2c1b9~~c.~t.', SCHEMA)).toBeNull()
  })
})
