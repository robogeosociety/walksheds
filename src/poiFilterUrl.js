/**
 * Encode/decode active POI filters as a single compact ?pois= query parameter.
 *
 * Canonical (machine-emitted) format: ?pois=1<cat-payload>[~<tag-payload>]
 *   - Leading "1" pins the encoding version, leaving room for future schemes.
 *   - Each payload is a delta-encoded varint stream of stable IDs from the
 *     build-time filter registry, base64url-packed without padding.
 *   - Categories and tags live in separate ID namespaces (so a "coffee"
 *     category and a "coffee" tag never collide). The `~` separator is
 *     omitted when the tag side is empty.
 *
 * Human-typed fallback: ?pois=<name>[,<name>...]
 *   - Comma-separated list of pill names (e.g. ?pois=pizza,vegan,coffee).
 *   - Each name is looked up in the tag namespace first, then the category
 *     namespace — matching what the user sees on screen. Unknown names drop
 *     silently. The app re-emits canonical form on the next URL update.
 *
 * The IDs are append-only: data/pois/filter-registry.json grows monotonically,
 * so URLs minted today decode against tomorrow's schema even if names get
 * added or removed.
 *
 * All canonical-output chars are URL-unreserved (base64url alphabet + `~` + digit).
 */

const VERSION = '1'
const SEP = '~'
// Selections at or below this count emit the human-readable comma-separated
// form (e.g. ?pois=coffee,parks,pizza). Beyond it, switch to the compact
// canonical form — CSV gets unwieldy fast and the savings start to matter.
const CSV_MAX_ITEMS = 3

function sameMembers(setLike, iterable) {
  const other = iterable instanceof Set ? iterable : new Set(iterable)
  if (setLike.size !== other.size) return false
  for (const x of setLike) if (!other.has(x)) return false
  return true
}

function encodeVarint(value, out) {
  let v = value >>> 0
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v & 0x7f)
}

function decodeVarints(bytes) {
  const out = []
  let i = 0
  while (i < bytes.length) {
    let v = 0
    let shift = 0
    while (true) {
      if (i >= bytes.length) return null  // truncated
      const b = bytes[i++]
      v |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
      if (shift > 28) return null  // overflow guard (IDs comfortably fit in 28 bits)
    }
    out.push(v >>> 0)
  }
  return out
}

function bytesToBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(str) {
  if (str === '') return new Uint8Array(0)
  if (!/^[A-Za-z0-9_-]*$/.test(str)) return null
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  let bin
  try { bin = atob(padded) } catch { return null }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sortNamesByRegistryId(names, nameToId) {
  const known = []
  for (const name of names) {
    const id = nameToId[name]
    if (typeof id === 'number') known.push([id, name])
  }
  known.sort((a, b) => a[0] - b[0])
  return known
}

function encodeIds(idNamePairs) {
  if (idNamePairs.length === 0) return ''
  const bytes = []
  let prev = 0
  for (const [id] of idNamePairs) {
    encodeVarint(id - prev, bytes)
    prev = id
  }
  return bytesToBase64Url(bytes)
}

function decodeIds(payload, idToName) {
  const bytes = base64UrlToBytes(payload)
  if (!bytes) return null
  const deltas = decodeVarints(bytes)
  if (!deltas) return null
  const out = new Set()
  let acc = 0
  for (const d of deltas) {
    acc += d
    const name = idToName[acc]
    if (name) out.add(name)
  }
  return out
}

function invertMap(nameToId) {
  const out = {}
  if (!nameToId) return out
  for (const name of Object.keys(nameToId)) {
    out[nameToId[name]] = name
  }
  return out
}

/**
 * Build a `?pois=...` query string fragment for the given filter state.
 *
 * Small selections (≤ CSV_MAX_ITEMS total) emit the human-readable
 * comma-separated form (e.g. ?pois=coffee,parks,pizza), which is friendlier
 * to type and recognize. Larger selections switch to the canonical compact
 * form (e.g. ?pois=1AwE~hAI) to keep URLs short.
 *
 * Returns '' when no filters are active OR when the state matches the
 * caller-supplied defaults — so default views and "no filter" links stay
 * clean.
 */
export function buildPoiFilterParam(enabledCategories, poiFilters, schema, defaultMainCategories = null) {
  if (!schema || schema.version !== 1) return ''
  if (
    poiFilters.size === 0 &&
    defaultMainCategories &&
    sameMembers(enabledCategories, defaultMainCategories)
  ) {
    return ''
  }

  const catPairs = sortNamesByRegistryId(enabledCategories, schema.cat || {})
  const tagPairs = sortNamesByRegistryId(poiFilters, schema.tag || {})
  const total = catPairs.length + tagPairs.length
  if (total === 0) return ''

  if (total <= CSV_MAX_ITEMS) {
    // Categories first (top-level toggles), tags after — each in registry-ID
    // order so the URL is deterministic regardless of insertion order.
    const names = [...catPairs.map(p => p[1]), ...tagPairs.map(p => p[1])]
    return `?pois=${names.join(',')}`
  }

  const catPayload = encodeIds(catPairs)
  const tagPayload = encodeIds(tagPairs)
  const body = tagPayload ? `${catPayload}${SEP}${tagPayload}` : catPayload
  return `?pois=${VERSION}${body}`
}

function parseCanonical(raw, schema) {
  const body = raw.slice(1)
  const sepIdx = body.indexOf(SEP)
  const catPart = sepIdx === -1 ? body : body.slice(0, sepIdx)
  const tagPart = sepIdx === -1 ? '' : body.slice(sepIdx + 1)

  const categories = decodeIds(catPart, invertMap(schema.cat))
  const tags = decodeIds(tagPart, invertMap(schema.tag))
  if (!categories || !tags) return null
  return { categories, tags }
}

function parseCsvNames(raw, schema) {
  const cats = new Set()
  const tags = new Set()
  const knownCats = schema.cat || {}
  const knownTags = schema.tag || {}
  const aliases = schema.aliases || {}
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (!name) continue
    // One-hop alias resolution before namespace lookup, so colloquial inputs
    // like `dispensary` route to the canonical `cannabis` tag. The build
    // guarantees alias values aren't themselves alias keys, so a single hop
    // is enough.
    const resolved = aliases[name] || name
    // Pills show tag names, so resolve tags first; fall back to a category
    // name (e.g. "restaurants", "parks") for users sharing top-level toggles.
    if (resolved in knownTags) tags.add(resolved)
    else if (resolved in knownCats) cats.add(resolved)
  }
  return { categories: cats, tags }
}

/**
 * Parse a query string into `{ categories, tags }` Sets, or null if the
 * `pois` param is absent, malformed, or yields nothing usable.
 *
 * Accepts two formats: the canonical compact form (starts with "1") and a
 * comma-separated list of pill names (any other input). Names or IDs absent
 * from the current schema are dropped silently.
 */
export function parsePoiFilterParam(search, schema) {
  if (!schema || schema.version !== 1) return null
  const params = new URLSearchParams(search)
  const raw = params.get('pois')
  if (!raw) return null

  // Try canonical first when the version byte matches; if it yields nothing
  // (malformed payload, or input that happens to start with "1" but is really
  // a comma-separated name like "1-star"), fall back to the by-name parser.
  let parsed = raw[0] === VERSION ? parseCanonical(raw, schema) : null
  if (!parsed || (parsed.categories.size === 0 && parsed.tags.size === 0)) {
    parsed = parseCsvNames(raw, schema)
  }
  if (!parsed) return null
  if (parsed.categories.size === 0 && parsed.tags.size === 0) return null
  return parsed
}
