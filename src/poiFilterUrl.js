/**
 * Encode/decode active POI filters as a single ?pois= query parameter.
 *
 * Format: ?pois=<hash>~c.<cat1>.<cat2>~t.<tag1>.<tag2>
 *   - <hash>: 8 hex chars from the pipeline's filter_schema fingerprint.
 *   - sections separated by `~`; section prefix `c.` = main categories, `t.` = tags.
 *   - empty section omitted; whole param omitted when no filters are active.
 *
 * Decoding is best-effort by NAME — names absent from the current schema are
 * dropped silently, and a hash mismatch only triggers a console.warn.
 *
 * All chars used (`a-z`, `0-9`, `-`, `.`, `~`) are URL-unreserved.
 */

const SECTION_SEP = '~'
const NAME_SEP = '.'
const CAT_PREFIX = 'c.'
const TAG_PREFIX = 't.'

function orderedIntersect(orderedList, presentSet) {
  const out = []
  for (const name of orderedList) {
    if (presentSet.has(name)) out.push(name)
  }
  return out
}

/**
 * Build a `?pois=...` query string fragment for the given filter state.
 * Returns '' when no filters are active.
 */
export function buildPoiFilterParam(enabledCategories, poiFilters, schema) {
  if (!schema || !schema.hash) return ''
  const cats = orderedIntersect(schema.main_categories || [], enabledCategories)
  const tags = orderedIntersect(schema.tags || [], poiFilters)
  if (cats.length === 0 && tags.length === 0) return ''

  const parts = [schema.hash]
  if (cats.length) parts.push(CAT_PREFIX + cats.join(NAME_SEP))
  if (tags.length) parts.push(TAG_PREFIX + tags.join(NAME_SEP))
  return '?pois=' + parts.join(SECTION_SEP)
}

/**
 * Parse a query string into `{ categories, tags }` Sets, or null if the
 * `pois` param is absent or yields nothing usable.
 *
 * Tag names not present in `schema.tags` are dropped. A hash mismatch is
 * non-fatal — the function logs a warning and continues by name.
 */
export function parsePoiFilterParam(search, schema) {
  if (!schema) return null
  const params = new URLSearchParams(search)
  const raw = params.get('pois')
  if (!raw) return null

  const sections = raw.split(SECTION_SEP)
  const hash = sections.shift()
  if (hash !== schema.hash) {
    console.warn(
      `[poiFilterUrl] schema hash mismatch (url=${hash} current=${schema.hash}); decoding by name`,
    )
  }

  const validCats = new Set(schema.main_categories || [])
  const validTags = new Set(schema.tags || [])
  const categories = new Set()
  const tags = new Set()

  for (const section of sections) {
    if (!section) continue
    if (section.startsWith(CAT_PREFIX)) {
      for (const name of section.slice(CAT_PREFIX.length).split(NAME_SEP)) {
        if (name && validCats.has(name)) categories.add(name)
      }
    } else if (section.startsWith(TAG_PREFIX)) {
      for (const name of section.slice(TAG_PREFIX.length).split(NAME_SEP)) {
        if (name && validTags.has(name)) tags.add(name)
      }
    }
  }

  if (categories.size === 0 && tags.size === 0) return null
  return { categories, tags }
}
