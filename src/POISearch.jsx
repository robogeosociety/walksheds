import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { StationPillBody } from './StationPill'
import { STATION_ALIASES } from './stationAliases'

// Mirror data/pois/fetch_pois.py:_normalize so search queries like "hot dog",
// "café", or "drive thru" reach the hyphenated canonical tags / alias keys.
function normalizeQuery(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_]+/g, '-')
}

const STATION_MATCH_CAP = 5
const POI_MATCH_CAP = 8

export default function POISearch({
  availableTags,
  globalAvailableTags,
  activeCategories,
  activeFilters,
  poiFeatures,
  expandedTag,
  onExpandTag,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  onPoiSelect,
  mainCategories,
  enabledCategories,
  onToggleCategory,
  tagAliases,
  stations,
  onStationSelect,
  onCommit,
}) {
  // Tags already pinned in either bucket — exclude from dropdown suggestions.
  const pinnedTags = useMemo(() => {
    const s = new Set()
    if (activeCategories) for (const t of activeCategories) s.add(t)
    if (activeFilters) for (const t of activeFilters) s.add(t)
    return s
  }, [activeCategories, activeFilters])
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [poiHighlightIdx, setPoiHighlightIdx] = useState(0)
  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const poiListRef = useRef(null)

  const { tagColors, tagCounts } = useMemo(() => {
    const colors = {}
    const counts = {}
    for (const { tag, color, count } of availableTags) {
      if (color) colors[tag] = color
      counts[tag] = count
    }
    return { tagColors: colors, tagCounts: counts }
  }, [availableTags])

  const poisForTag = useMemo(() => {
    if (!expandedTag || !poiFeatures) return []
    return poiFeatures.filter(f => {
      const tags = f.properties?.tags
      return Array.isArray(tags) && tags.includes(expandedTag)
    }).sort((a, b) => (a.properties.name || '').localeCompare(b.properties.name || ''))
  }, [expandedTag, poiFeatures])

  useEffect(() => {
    if (!poiListRef.current) return
    const items = poiListRef.current.querySelectorAll('[data-poi-item]')
    items[poiHighlightIdx]?.scrollIntoView({ block: 'nearest' })
  }, [poiHighlightIdx])

  // Inverse of tagAliases: canonical → [aliasKey, ...]. Lets the search box
  // surface a canonical chip when the user types one of its aliases.
  const canonicalToAliases = useMemo(() => {
    const inv = {}
    if (!tagAliases) return inv
    for (const alias of Object.keys(tagAliases)) {
      const canonical = tagAliases[alias]
      if (!inv[canonical]) inv[canonical] = []
      inv[canonical].push(alias)
    }
    return inv
  }, [tagAliases])

  // Find stations by stop code, "line-code" prefix, normalized name substring,
  // or alias key — mirrors the canonical+alias two-step the POI matcher uses
  // (see tryMatch below), but always renders the canonical station name so
  // every row reuses StationPillBody.
  const stationMatches = useMemo(() => {
    if (!stations?.length || !query.trim()) return []
    const q = normalizeQuery(query)

    // "1-50" / "2 54" → exact line + stop code lookup.
    const linePrefix = q.match(/^([12])-(\d{1,2})$/)
    if (linePrefix) {
      const [, line, codeStr] = linePrefix
      const code = parseInt(codeStr, 10)
      return stations.filter(s =>
        s.stopCode === code && (s.lines || '').split(',').map(x => x.trim()).includes(line)
      ).slice(0, STATION_MATCH_CAP)
    }

    // 1–2 digit numeric → stop code lookup (Westlake = 50, shared 54, etc.).
    if (/^\d{1,2}$/.test(q)) {
      const code = parseInt(q, 10)
      return stations.filter(s => s.stopCode === code).slice(0, STATION_MATCH_CAP)
    }

    const seen = new Set()
    const out = []
    for (const s of stations) {
      if (out.length >= STATION_MATCH_CAP) break
      const nameNorm = normalizeQuery(s.name)
      if (nameNorm.includes(q)) {
        seen.add(s.name)
        out.push(s)
      }
    }
    if (out.length < STATION_MATCH_CAP) {
      for (const [alias, canonical] of Object.entries(STATION_ALIASES)) {
        if (out.length >= STATION_MATCH_CAP) break
        if (!alias.includes(q)) continue
        if (seen.has(canonical)) continue
        const s = stations.find(st => st.name === canonical)
        if (s) {
          seen.add(canonical)
          out.push(s)
        }
      }
    }
    return out
  }, [stations, query])

  const tagMatches = useMemo(() => {
    const filtered = availableTags.filter(({ tag }) => !pinnedTags.has(tag))
    if (!query.trim()) {
      return filtered.slice(0, POI_MATCH_CAP).map(t => ({ ...t, label: t.tag }))
    }
    const q = normalizeQuery(query)
    // Single-pass match: tries the canonical tag first, then any alias. Used
    // for both walkshed-scoped (primary) and global (fallback) result rows.
    const tryMatch = (t) => {
      if (t.tag.includes(q)) return { ...t, label: t.tag }
      const aliases = canonicalToAliases[t.tag]
      const hit = aliases?.find(a => a.includes(q))
      return hit ? { ...t, label: hit } : null
    }
    const out = []
    for (const t of filtered) {
      const m = tryMatch(t)
      if (m) out.push(m)
    }
    // Pad with out-of-walkshed matches when the in-walkshed dropdown isn't
    // full. The greyed row tells the user the tag exists in Seattle but not
    // near this station, instead of returning an empty dropdown.
    if (out.length < POI_MATCH_CAP && globalAvailableTags?.length) {
      const localSet = new Set(availableTags.map(t => t.tag))
      for (const t of globalAvailableTags) {
        if (out.length >= POI_MATCH_CAP) break
        if (localSet.has(t.tag) || pinnedTags.has(t.tag)) continue
        const m = tryMatch(t)
        if (m) out.push({ ...m, outOfWalkshed: true })
      }
    }
    return out.slice(0, POI_MATCH_CAP)
  }, [query, availableTags, globalAvailableTags, pinnedTags, canonicalToAliases])

  // Unified dropdown list — stations first, then POI tags. The keyboard
  // handler treats this as one indexable array; `kind` routes Enter to the
  // right callback.
  const matches = useMemo(() => [
    ...stationMatches.map(s => ({ kind: 'station', station: s })),
    ...tagMatches.map(t => ({ kind: 'tag', ...t })),
  ], [stationMatches, tagMatches])

  const handleSelect = useCallback((tag) => {
    onAddFilter(tag)
    setQuery('')
    setShowDropdown(false)
    setHighlightIdx(0)
    // Release the search input so keyboard focus can move to the map
    // (the caller handles where exactly focus lands).
    inputRef.current?.blur()
    onCommit?.()
  }, [onAddFilter, onCommit])

  const handleStationSelect = useCallback((station) => {
    onStationSelect?.(station)
    setQuery('')
    setShowDropdown(false)
    setHighlightIdx(0)
    inputRef.current?.blur()
    onCommit?.()
  }, [onStationSelect, onCommit])

  const handleCategoryToggle = useCallback((catId) => {
    onToggleCategory?.(catId)
    onCommit?.()
  }, [onToggleCategory, onCommit])

  const commitMatch = useCallback((item) => {
    if (!item) return
    if (item.kind === 'station') handleStationSelect(item.station)
    else handleSelect(item.tag)
  }, [handleSelect, handleStationSelect])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setShowDropdown(false)
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      if (!showDropdown) setShowDropdown(true)
      setHighlightIdx(i => Math.min(i + 1, matches.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (!showDropdown) setShowDropdown(true)
      setHighlightIdx(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault()
      commitMatch(matches[highlightIdx] ?? matches[0])
      return
    }
  }, [matches, highlightIdx, commitMatch, showDropdown])

  const handleInput = useCallback((e) => {
    setQuery(e.target.value)
    setShowDropdown(true)
    setHighlightIdx(0)
  }, [])

  const handleTagTextClick = useCallback((tag, e) => {
    e.stopPropagation()
    const next = expandedTag === tag ? null : tag
    onExpandTag(next)
    setPoiHighlightIdx(0)
    if (next) {
      requestAnimationFrame(() => poiListRef.current?.focus())
    }
  }, [expandedTag, onExpandTag])

  const handleRemoveTag = useCallback((tag, e) => {
    e.stopPropagation()
    if (expandedTag === tag) onExpandTag(null)
    onRemoveFilter(tag)
  }, [expandedTag, onExpandTag, onRemoveFilter])

  const handlePoiListKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setPoiHighlightIdx(i => Math.min(i + 1, poisForTag.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setPoiHighlightIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && poisForTag.length > 0) {
      e.preventDefault()
      onPoiSelect?.(poisForTag[poiHighlightIdx])
    } else if (e.key === 'Escape') {
      onExpandTag(null)
    }
  }, [poisForTag, poiHighlightIdx, onPoiSelect, onExpandTag])

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false)
        onExpandTag(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onExpandTag])

  const categoryPillList = [...(activeCategories || [])]
  const filterRowList = [...(activeFilters || [])]
  const hasAnyPills = (mainCategories?.length ?? 0) > 0 || categoryPillList.length > 0
  const totalActive = categoryPillList.length + filterRowList.length + (enabledCategories?.size ?? 0)

  return (
    <div className="poi-search" ref={containerRef}>
      <div className="poi-search-input-row">
        <svg className="poi-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10.5 10.5L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          className="poi-search-input"
          type="text"
          placeholder="Search stations or places..."
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && matches.length > 0 && (
        <div className="poi-search-dropdown">
          {matches.map((item, i) => {
            const highlighted = i === highlightIdx ? 'highlighted' : ''
            if (item.kind === 'station') {
              const s = item.station
              return (
                <button
                  key={`station-${s.lines}-${s.stopCode}`}
                  className={`poi-search-option poi-search-option-station ${highlighted}`}
                  onMouseDown={(e) => { e.preventDefault(); handleStationSelect(s) }}
                  onMouseEnter={() => setHighlightIdx(i)}
                >
                  <StationPillBody
                    lines={s.lines}
                    stopCode={s.stopCode}
                    name={s.name}
                    className="expanded"
                  />
                </button>
              )
            }
            const { tag, label, count, color, outOfWalkshed } = item
            return (
              <button
                key={`tag-${tag}`}
                className={`poi-search-option ${highlighted}${outOfWalkshed ? ' out-of-walkshed' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(tag) }}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                {color && <span className="poi-search-option-dot" style={{ background: color }} />}
                <span className="poi-search-option-tag">{label}</span>
                {outOfWalkshed
                  ? <span className="poi-search-option-note">not in walkshed</span>
                  : <span className="poi-search-option-count">{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {hasAnyPills && (
        <div className="poi-cat-pills">
          {mainCategories?.map(({ id, label, color }) => {
            const enabled = enabledCategories?.has(id)
            return (
              <button
                key={`main:${id}`}
                type="button"
                className={`poi-cat-pill ${enabled ? 'enabled' : 'disabled'}`}
                style={{
                  borderColor: color,
                  background: enabled ? color : color + '40',
                  color: enabled ? '#fff' : color,
                }}
                onClick={() => handleCategoryToggle(id)}
              >
                {label}
              </button>
            )
          })}

          {categoryPillList.map(tag => {
            const color = tagColors[tag] || '#666'
            const count = tagCounts[tag] ?? 0
            const present = count > 0
            const stateClass = present ? 'enabled' : 'disabled'
            return (
              <span
                key={`tag:${tag}`}
                className={`poi-cat-pill poi-cat-pill-tag ${stateClass}`}
                style={{
                  borderColor: color,
                  background: present ? color : color + '40',
                  color: present ? '#fff' : color,
                }}
              >
                {present && (
                  <span
                    className="poi-cat-pill-chevron"
                    onClick={(e) => handleTagTextClick(tag, e)}
                    role="button"
                    aria-label={expandedTag === tag ? `Collapse ${tag} list` : `Expand ${tag} list`}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <path
                        d={expandedTag === tag ? 'M1.5 5l2.5-2.5 2.5 2.5' : 'M1.5 3l2.5 2.5 2.5-2.5'}
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  </span>
                )}
                <span
                  className="poi-cat-pill-text"
                  onClick={(e) => handleTagTextClick(tag, e)}
                >
                  {tag}
                </span>
                <span
                  className="poi-cat-pill-count"
                  onClick={(e) => handleTagTextClick(tag, e)}
                >
                  {count}
                </span>
                <span
                  className="poi-cat-pill-remove"
                  onClick={(e) => handleRemoveTag(tag, e)}
                  role="button"
                  aria-label={`Remove ${tag}`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </span>
              </span>
            )
          })}

          {totalActive >= 2 && (
            <button className="poi-cat-pill poi-cat-pill-clear" onClick={onClearFilters}>
              clear all
            </button>
          )}
        </div>
      )}

      {filterRowList.length > 0 && (
        <div className="poi-filter-list">
          {filterRowList.map(tag => {
            const color = tagColors[tag] || '#666'
            const count = tagCounts[tag] ?? 0
            return (
              <label key={`filter:${tag}`} className="poi-filter-row">
                <input
                  type="checkbox"
                  className="poi-filter-checkbox"
                  checked
                  onChange={() => onRemoveFilter(tag)}
                  aria-label={`Remove ${tag} filter`}
                  style={{ accentColor: color }}
                />
                <span className="poi-filter-dot" style={{ background: color }} />
                <span className="poi-filter-label">{tag}</span>
                <span className="poi-filter-count">{count}</span>
              </label>
            )
          })}
        </div>
      )}

      {expandedTag && poisForTag.length > 0 && (
        <div className="poi-chip-poi-list" ref={poiListRef} tabIndex={-1} onKeyDown={handlePoiListKeyDown}>
          {poisForTag.map((f, i) => (
            <button
              key={f.properties.id}
              data-poi-item
              className={`poi-chip-poi-item ${i === poiHighlightIdx ? 'highlighted' : ''}`}
              onClick={() => onPoiSelect?.(f)}
              onMouseEnter={() => setPoiHighlightIdx(i)}
            >
              <span className="poi-chip-poi-dot" style={{ background: tagColors[expandedTag] || '#999' }} />
              <span className="poi-chip-poi-name">{f.properties.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
