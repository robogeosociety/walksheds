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

  it('emits the human CSV form for ≤3 total selections', () => {
    expect(buildPoiFilterParam(new Set(['restaurants']), new Set(), SCHEMA))
      .toBe('?pois=restaurants')
    expect(buildPoiFilterParam(new Set(['restaurants', 'bars']), new Set(), SCHEMA))
      .toBe('?pois=restaurants,bars')
    expect(buildPoiFilterParam(new Set(['restaurants']), new Set(['pizza', 'vegan']), SCHEMA))
      .toBe('?pois=restaurants,pizza,vegan')
  })

  it('flips to canonical compact form once total selections exceed 3', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars']),
      new Set(['pizza', 'vegan']),
      SCHEMA,
    )
    expect(out.startsWith('?pois=1')).toBe(true)
    expect(out.includes(',')).toBe(false)
  })

  it('CSV order is categories-then-tags by registry ID, regardless of insertion order', () => {
    const a = buildPoiFilterParam(new Set(['parks', 'restaurants']), new Set(['vegan']), SCHEMA)
    const b = buildPoiFilterParam(new Set(['restaurants', 'parks']), new Set(['vegan']), SCHEMA)
    expect(a).toBe(b)
    expect(a).toBe('?pois=restaurants,parks,vegan')
  })

  it('canonical form uses only URL-unreserved characters', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars', 'coffee', 'parks']),
      new Set(['coffee-shop', 'pizza', 'vegan', 'wheelchair-accessible']),
      SCHEMA,
    )
    expect(out.startsWith('?pois=1')).toBe(true)
    expect(out.slice('?pois='.length)).toMatch(/^[A-Za-z0-9_~-]+$/)
  })

  it('CSV form uses only URL-safe characters', () => {
    const out = buildPoiFilterParam(new Set(['restaurants']), new Set(['wheelchair-accessible']), SCHEMA)
    expect(out.slice('?pois='.length)).toMatch(/^[a-z0-9,-]+$/)
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
    // 3 total selections → CSV form, not canonical.
    expect(out).toBe('?pois=coffee,parks,pizza')
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

  it('produces compact URLs even for the worst case (all selections enabled)', () => {
    const out = buildPoiFilterParam(
      new Set(['restaurants', 'bars', 'coffee', 'parks']),
      new Set(['coffee-shop', 'pizza', 'vegan', 'wheelchair-accessible']),
      SCHEMA,
    )
    // 8 items → canonical form. Old format was 39+ chars for far less.
    expect(out.length).toBeLessThan(25)
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

  it('returns null when the input is neither canonical nor a known name', () => {
    expect(parsePoiFilterParam('?pois=9deadbeef', SCHEMA)).toBeNull()
    // Legacy ?pois= format (hash + tilde-delimited names). All names absent
    // from SCHEMA, so the CSV fallback also yields nothing.
    expect(parsePoiFilterParam('?pois=a3f2c1b9~c.restaurants', SCHEMA)).toBeNull()
  })

  it('falls back to by-name when a tag name happens to start with the version byte', () => {
    const schema = { version: 1, cat: {}, tag: { '1-star': 7, pizza: 0 } }
    const parsed = parsePoiFilterParam('?pois=1-star', schema)
    expect(parsed.tags).toEqual(new Set(['1-star']))
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

  it('round-trips combined state (canonical form, >3 items)', () => {
    const cats = ['restaurants', 'parks']
    const tags = ['pizza', 'wheelchair-accessible']
    const parsed = roundTrip(cats, tags)
    expect(parsed.categories).toEqual(new Set(cats))
    expect(parsed.tags).toEqual(new Set(tags))
  })

  it('round-trips combined state (CSV form, ≤3 items)', () => {
    const cats = ['restaurants']
    const tags = ['pizza', 'vegan']
    const parsed = roundTrip(cats, tags)
    expect(parsed.categories).toEqual(new Set(cats))
    expect(parsed.tags).toEqual(new Set(tags))
  })

  it('insertion order does not affect output (canonical form)', () => {
    // 4 selections → canonical form; ordering still must be stable.
    const a = buildPoiFilterParam(
      new Set(['parks', 'restaurants']),
      new Set(['vegan', 'pizza']),
      SCHEMA,
    )
    const b = buildPoiFilterParam(
      new Set(['restaurants', 'parks']),
      new Set(['pizza', 'vegan']),
      SCHEMA,
    )
    expect(a).toBe(b)
    expect(a.startsWith('?pois=1')).toBe(true)
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

describe('parsePoiFilterParam — comma-separated names (human-typed)', () => {
  it('reads a single tag name', () => {
    const parsed = parsePoiFilterParam('?pois=pizza', SCHEMA)
    expect(parsed.tags).toEqual(new Set(['pizza']))
    expect(parsed.categories.size).toBe(0)
  })

  it('reads multiple tag names separated by commas', () => {
    const parsed = parsePoiFilterParam('?pois=pizza,vegan,wheelchair-accessible', SCHEMA)
    expect(parsed.tags).toEqual(new Set(['pizza', 'vegan', 'wheelchair-accessible']))
  })

  it('routes category names to the categories set', () => {
    const parsed = parsePoiFilterParam('?pois=restaurants,parks', SCHEMA)
    expect(parsed.categories).toEqual(new Set(['restaurants', 'parks']))
    expect(parsed.tags.size).toBe(0)
  })

  it('mixes categories and tags by name', () => {
    const parsed = parsePoiFilterParam('?pois=restaurants,pizza,parks', SCHEMA)
    expect(parsed.categories).toEqual(new Set(['restaurants', 'parks']))
    expect(parsed.tags).toEqual(new Set(['pizza']))
  })

  it('resolves overlapping names to the tag namespace (pills win)', () => {
    // Pills surface tag names; if a user types a name present in both
    // namespaces, the tag should light up — that's what they see on screen.
    const ambiguous = {
      version: 1,
      cat: { coffee: 0, parks: 1 },
      tag: { coffee: 0, pizza: 1 },
    }
    const parsed = parsePoiFilterParam('?pois=coffee', ambiguous)
    expect(parsed.tags).toEqual(new Set(['coffee']))
    expect(parsed.categories.size).toBe(0)
  })

  it('tolerates whitespace around names', () => {
    const parsed = parsePoiFilterParam('?pois= pizza , vegan ', SCHEMA)
    expect(parsed.tags).toEqual(new Set(['pizza', 'vegan']))
  })

  it('drops unknown names silently', () => {
    const parsed = parsePoiFilterParam('?pois=pizza,not-a-real-tag', SCHEMA)
    expect(parsed.tags).toEqual(new Set(['pizza']))
  })

  it('returns null when no names resolve', () => {
    expect(parsePoiFilterParam('?pois=not-a-real-tag', SCHEMA)).toBeNull()
    expect(parsePoiFilterParam('?pois=,,,', SCHEMA)).toBeNull()
  })
})
