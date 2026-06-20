import { POI_CATEGORIES } from './constants'

// House glyphs for POI categories (issue #19): simplified white strokes in a
// 24x24 viewBox, the same idiom as the station line roundels. Keyed by POI
// group with a few per-category overrides (burger for fast food, cup for cafe,
// glass for bar/pub). This is the single source of truth shared by the popup
// roundel + map marker (via CategoryIcon) and the filter pills (via POISearch).

const GROUP_GLYPHS = {
  // Fork and knife
  dining: 'M8.5 4v4.5a1.5 1.5 0 0 0 3 0V4 M10 4v16 M15.5 4c1.8 2.8 1.8 6.2 0 8.5V20',
  // Five-point star
  attractions: 'M12 4.5l2.1 4.5 4.9.6-3.7 3.4 1 4.9-4.3-2.5-4.3 2.5 1-4.9L5 9.6l4.9-.6z',
  // Evergreen tree
  parks: 'M12 4l4.5 6.5h-2.5L18 16H6l4-5.5H7.5L12 4z M12 16v4',
  // Bed
  lodging: 'M4 7v10 M4 14h16v3 M4 11h7v3 M11 12h6a3 3 0 0 1 3 3',
  // Shopping bag
  shops: 'M7 9h10l1 10H6L7 9z M9 9V7.5a3 3 0 0 1 6 0V9',
  // Medical cross
  healthcare: 'M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z',
  // Civic building with columns
  services: 'M4 9l8-4.5L20 9 M6 9v8 M10.5 9v8 M13.5 9v8 M18 9v8 M4 17.5h16',
  // Dumbbell
  fitness: 'M7 9v6 M4.5 10.5v3 M17 9v6 M19.5 10.5v3 M7 12h10',
}

const CATEGORY_GLYPHS = {
  // Burger: bun, patty, base
  fast_food: 'M5.5 10a6.5 4.5 0 0 1 13 0z M5.5 13h13 M6.5 16.5h11',
  // Coffee cup with handle
  cafe: 'M5 9h10v5.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z M15 10h1.5a2.25 2.25 0 0 1 0 4.5H15',
  // Martini glass
  bar: 'M6 5h12l-6 7v6 M9.5 18.5h5',
  pub: 'M6 5h12l-6 7v6 M9.5 18.5h5',
  // Open book
  library: 'M12 6.5C10.5 5.3 8 5 5 5.5v12c3-.5 5.5-.2 7 1 1.5-1.2 4-1.5 7-1v-12c-3-.5-5.5-.2-7 1.3z M12 6.5v12',
}

// Fallback: a simple map-pin
export const DEFAULT_GLYPH = 'M12 20s-5.5-5-5.5-9.2A5.5 5.5 0 0 1 12 5.5a5.5 5.5 0 0 1 5.5 5.3C17.5 15 12 20 12 20z'

// A handful of filter tags whose name isn't a POI category key but reads as
// one (the flagship default pill `coffee` is a `cafe`). Keep this tiny — it is
// only for tags that clearly *are* a category under a different word.
const TAG_CATEGORY_ALIASES = { coffee: 'cafe' }

// The single source of truth for "which glyph does this place get": a per-
// category override, else the group glyph, else the map-pin. Shared by the
// popup roundel, the map marker (via CategoryIcon), and the filter pills.
export function categoryGlyph(group, category) {
  return CATEGORY_GLYPHS[category] || GROUP_GLYPHS[group] || DEFAULT_GLYPH
}

// Resolve a *filter tag* (e.g. `coffee`, `park`, `swimming-pool`) to a glyph by
// treating it as a POI category: alias a couple of common words, fold hyphens
// to the underscore category keys, then reuse the same glyph tables. Returns
// null (no glyph — pill stays text-only) for tags that aren't a category, e.g.
// cuisine/diet/vibe tags like `pizza` or `vegan`, so we never show a misleading
// or default pin on a pill.
export function categoryGlyphForTag(tag) {
  if (!tag) return null
  const norm = (TAG_CATEGORY_ALIASES[tag] || String(tag)).replace(/-/g, '_')
  if (CATEGORY_GLYPHS[norm]) return CATEGORY_GLYPHS[norm]
  const group = POI_CATEGORIES[norm]?.group
  if (group && GROUP_GLYPHS[group]) return GROUP_GLYPHS[group]
  return null
}
