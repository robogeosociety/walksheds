import { POI_CATEGORIES, POI_GROUP_COLORS } from './constants'
import { categoryGlyph } from './categoryGlyphs'

// Category roundel for the POI popup + map marker (issue #19): a simplified
// white house glyph on a circle filled with the category color — the same
// roundel idiom as the station line circles. The glyph tables + resolvers live
// in ./categoryGlyphs (shared with the filter pills); this file owns the
// rendered component only.

function categoryColor(category) {
  return POI_CATEGORIES[category]?.color
    || POI_GROUP_COLORS[POI_CATEGORIES[category]?.group]
    || '#999'
}

export default function CategoryIcon({ category, size = 22 }) {
  const meta = POI_CATEGORIES[category]
  const glyph = categoryGlyph(meta?.group, category)
  return (
    <span
      className="poi-category-icon"
      style={{ width: size, height: size, background: categoryColor(category) }}
      role="img"
      aria-label={meta?.label || category || 'Place'}
    >
      <svg width={size - 6} height={size - 6} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={glyph}
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  )
}
