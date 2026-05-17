import { describe, it, expect } from 'vitest'
import { buildPoiFilterParam, parsePoiFilterParam } from '../poiFilterUrl'

// IDs are deliberately interleaved/sparse to make sure encoding doesn't
// assume contiguous or insertion-order numbering.
const SCHEMA = {
  version: 1,
  cat: { restaurants: 0, bars: 1, coffee: 2, parks: 3 },
  tag: { 'coffee-shop': 0, pizza: 1, vegan: 2, 'wheelchair-accessible': 3 },
}

function roundTrip(cats, tags, schema = SCHEMA) {
  const url = buildPoiFilterParam(new Set(cats), new Set(tags), schema)
  return parsePoiFilterParam(url, schema)
}

describe('buildPoiFilterParam', () => {
  it('returns empty string for empty filter state', () => {
    expect(buildPoiFilterParam(new Set(), new Set(), SCHEMA)).toBe('')
  })

  it('returns empty string when schema is missing or wrong version', () => {
    expect(buildPoiFilterParam(new Set(['restaurants']), new Set(['pizza']), null)).toBe('')
    expect(buildPoiFilterParam(new Set(['restaurants']), new Set(['pizza']), { version: 99 })).toBe('')
  })

  it('emits the version prefix', () => {
    const out = buildPoiFilterParam(new Set(['restaurants']), new Set(), SCHEMA)
    expect(out.startsWith('?pois=1')).toBe(true)
  })

  it('omits the tag separator when only categories are selected', () => {
    const out = buildPoiFilterParam(new Set(['restaurants', 'bars']), new Set(), SCHEMA)
    expect(out.includes('~')).toBe(false)
  })

  it('emits an empty cat payload when only tags are selected', () => {
    const out = buildPoiFilterParam(new Set(), new Set(['pizza']), SCHEMA)
    // Format: ?pois=1<empty-cat>~<tag-payload>
    expect(out.startsWith('?pois=1~')).toBe(true)
  })

  it('uses only URL-unreserved characters', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars', 'coffee', 'parks']),
      new Set(['coffee-shop', 'pizza', 'vegan', 'wheelchair-accessible']),
      SCHEMA,
    )
    expect(out.slice('?pois='.length)).toMatch(/^[A-Za-z0-9_~-]+$/)
  })

  it('returns empty string when state matches the supplied defaults', () => {
    const defaults = ['parks', 'coffee']
    expect(buildPoiFilterParam(new Set(['parks', 'coffee']), new Set(), SCHEMA, defaults)).toBe('')
    expect(buildPoiFilterParam(new Set(['coffee', 'parks']), new Set(), SCHEMA, defaults)).toBe('')
  })

  it('encodes when categories diverge from defaults', () => {
    const defaults = ['parks', 'coffee']
    const out = buildPoiFilterParam(new Set(['parks']), new Set(), SCHEMA, defaults)
    expect(out).not.toBe('')
  })

  it('encodes when defaults are present but tags are also selected', () => {
    const defaults = ['parks', 'coffee']
    const out = buildPoiFilterParam(new Set(['parks', 'coffee']), new Set(['pizza']), SCHEMA, defaults)
    expect(out).not.toBe('')
    expect(out.includes('~')).toBe(true)
  })

  it('drops names not in the schema', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'unknown-cat']),
      new Set(['pizza', 'unknown-tag']),
      SCHEMA,
    )
    // Should still round-trip back to the known ones only.
    const parsed = parsePoiFilterParam(out, SCHEMA)
    expect(parsed.categories).toEqual(new Set(['restaurants']))
    expect(parsed.tags).toEqual(new Set(['pizza']))
  })

  it('produces compact URLs', () => {
    // 1 cat + 1 tag with small IDs should fit in well under the old format's 39 chars.
    const out = buildPoiFilterParam(new Set(['coffee']), new Set(['pizza']), SCHEMA)
    expect(out.length).toBeLessThan(15)
  })
})

describe('parsePoiFilterParam', () => {
  it('returns null when search is empty', () => {
    expect(parsePoiFilterParam('', SCHEMA)).toBeNull()
  })

  it('returns null when no pois param is present', () => {
    expect(parsePoiFilterParam('?walkshed=10', SCHEMA)).toBeNull()
  })

  it('returns null when schema is missing or wrong version', () => {
    expect(parsePoiFilterParam('?pois=1Aw', null)).toBeNull()
    expect(parsePoiFilterParam('?pois=1Aw', { version: 99 })).toBeNull()
  })

  it('returns null when the version prefix is unknown', () => {
    expect(parsePoiFilterParam('?pois=9deadbeef', SCHEMA)).toBeNull()
    // Legacy format: hash-then-tilde — first char is hex, not "1".
    expect(parsePoiFilterParam('?pois=a3f2c1b9~c.restaurants', SCHEMA)).toBeNull()
  })

  it('round-trips categories only', () => {
    const parsed = roundTrip(['restaurants', 'bars'], [])
    expect(parsed.categories).toEqual(new Set(['restaurants', 'bars']))
    expect(parsed.tags.size).toBe(0)
  })

  it('round-trips tags only', () => {
    const parsed = roundTrip([], ['pizza', 'vegan'])
    expect(parsed.categories.size).toBe(0)
    expect(parsed.tags).toEqual(new Set(['pizza', 'vegan']))
  })

  it('round-trips combined state', () => {
    const cats = ['restaurants', 'parks']
    const tags = ['pizza', 'wheelchair-accessible']
    const parsed = roundTrip(cats, tags)
    expect(parsed.categories).toEqual(new Set(cats))
    expect(parsed.tags).toEqual(new Set(tags))
  })

  it('insertion order does not affect output', () => {
    const a = buildPoiFilterParam(new Set(['parks', 'restaurants']), new Set(['vegan', 'pizza']), SCHEMA)
    const b = buildPoiFilterParam(new Set(['restaurants', 'parks']), new Set(['pizza', 'vegan']), SCHEMA)
    expect(a).toBe(b)
  })

  it('drops unknown IDs silently when the schema has shrunk', () => {
    // Build with a schema that knows about "vegan", then decode with one that doesn't.
    const url = buildPoiFilterParam(new Set(), new Set(['pizza', 'vegan']), SCHEMA)
    const shrunk = { version: 1, cat: SCHEMA.cat, tag: { pizza: 1 } }  // dropped vegan and others
    const parsed = parsePoiFilterParam(url, shrunk)
    expect(parsed.tags).toEqual(new Set(['pizza']))
  })

  it('returns null for garbage param values', () => {
    expect(parsePoiFilterParam('?pois=1!!!', SCHEMA)).toBeNull()
  })

  it('survives an empty payload after the version prefix', () => {
    expect(parsePoiFilterParam('?pois=1', SCHEMA)).toBeNull()
  })

  it('handles two-byte varints (IDs >= 128)', () => {
    const wideSchema = { version: 1, cat: {}, tag: { 'big-id': 200, 'bigger-id': 5000 } }
    const url = buildPoiFilterParam(new Set(), new Set(['big-id', 'bigger-id']), wideSchema)
    const parsed = parsePoiFilterParam(url, wideSchema)
    expect(parsed.tags).toEqual(new Set(['big-id', 'bigger-id']))
  })
})
