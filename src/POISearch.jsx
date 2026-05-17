import { useState, useCallback, useMemo, useRef, useEffect } from 'react'

export default function POISearch({
  availableTags,
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
  onCommit,
}) {
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

  const matches = useMemo(() => {
    const filtered = availableTags.filter(({ tag }) => !activeFilters.has(tag))
    if (!query.trim()) {
      return filtered.slice(0, 8).map(t => ({ ...t, label: t.tag }))
    }
    const q = query.trim().toLowerCase()
    const out = []
    for (const t of filtered) {
      // Direct hit on the canonical tag wins — show the tag itself.
      if (t.tag.includes(q)) {
        out.push({ ...t, label: t.tag })
        continue
      }
      // Otherwise see if any alias for this canonical matches; if so, show
      // the matched alias as the dropdown label so the user sees the term
      // they typed. Selection still adds the canonical tag.
      const aliases = canonicalToAliases[t.tag]
      const hit = aliases?.find(a => a.includes(q))
      if (hit) out.push({ ...t, label: hit })
    }
    return out.slice(0, 8)
  }, [query, availableTags, activeFilters, canonicalToAliases])

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

  const handleCategoryToggle = useCallback((catId) => {
    onToggleCategory?.(catId)
    onCommit?.()
  }, [onToggleCategory, onCommit])

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
      handleSelect(matches[highlightIdx]?.tag || matches[0].tag)
      return
    }
  }, [matches, highlightIdx, handleSelect, showDropdown])

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

  const activeTagList = [...activeFilters]
  const hasAnyPills = (mainCategories?.length ?? 0) > 0 || activeTagList.length > 0

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
          placeholder="Search places..."
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && matches.length > 0 && (
        <div className="poi-search-dropdown">
          {matches.map(({ tag, label, count, color }, i) => (
            <button
              key={tag}
              className={`poi-search-option ${i === highlightIdx ? 'highlighted' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(tag) }}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              {color && <span className="poi-search-option-dot" style={{ background: color }} />}
              <span className="poi-search-option-tag">{label}</span>
              <span className="poi-search-option-count">{count}</span>
            </button>
          ))}
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

          {activeTagList.map(tag => {
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

          {(activeFilters.size + (enabledCategories?.size ?? 0)) >= 2 && (
            <button className="poi-cat-pill poi-cat-pill-clear" onClick={onClearFilters}>
              clear all
            </button>
          )}
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
