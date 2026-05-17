import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { buildGraph, isJunction, getJunctionHints } from './routeGraph'
import { fetchWalkshed, getLargestEnabledBounds } from './mapbox'
import { WALKSHED_OPTIONS, LINE_COLORS, WALKSHED_ACCENT_LIGHT, WALKSHED_ACCENT_DARK, SEATTLE_CENTER, SEATTLE_ZOOM, POI_FILES, MAIN_POI_CATEGORIES, DEFAULT_ENABLED_MAIN_CATEGORIES } from './constants'
import { parseStationPath, buildStationPath, findStationByCode, parseWalkshedParams, buildWalkshedParams, combineQuery } from './deepLink'
import { buildPoiFilterParam, parsePoiFilterParam } from './poiFilterUrl'
import { filterPOIsInWalkshed, filterByMainCategoriesAndTags, getAvailableTags, mergeFeatureCollections } from './poiUtils'
import { useNavigation } from './useNavigation'
import MapView from './MapView'
import LineLegend from './LineLegend'
import POISearch from './POISearch'
import Intro from './Intro'
import { shouldShowIntro } from './introState'
import './walksheds.css'

function legendOverlapsWalkshed(map, walksheds, enabledWalksheds) {
  if (!map) return false
  const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
  if (!bounds) return false
  try {
    const topLeft = map.project(bounds[0])
    const bottomRight = map.project(bounds[1])
    const wsLeft = Math.min(topLeft.x, bottomRight.x)
    const wsBottom = Math.max(topLeft.y, bottomRight.y)
    const container = map.getContainer()
    const h = container.clientHeight
    const legendBottom = h - 32
    const legendRight = 16 + 180
    const legendTop = legendBottom - 280
    return wsLeft < legendRight && wsBottom > legendTop
  } catch {
    return false
  }
}

function computeLegendPosition(map, walksheds, enabledWalksheds) {
  if (!map) return 'bottom-left'
  const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
  if (!bounds) return 'bottom-left'

  try {
    const topLeft = map.project(bounds[0])
    const bottomRight = map.project(bounds[1])
    const wsLeft = Math.min(topLeft.x, bottomRight.x)
    const wsBottom = Math.max(topLeft.y, bottomRight.y)
    // Legend is ~180px wide, ~280px tall, at bottom-left with 16px margin + 32px bottom
    const container = map.getContainer()
    const h = container.clientHeight
    const legendBottom = h - 32
    const legendLeft = 16
    const legendRight = legendLeft + 180
    const legendTop = legendBottom - 280
    // Check if walkshed polygon overlaps the bottom-left legend area
    if (wsLeft < legendRight && wsBottom > legendTop) {
      return 'bottom-right'
    }
  } catch {
    // map.project can throw if map not ready
  }
  return 'bottom-left'
}

export default function Walksheds() {
  const [popup, setPopup] = useState(null)
  const [walksheds, setWalksheds] = useState({})
  const [enabledWalksheds, setEnabledWalksheds] = useState(() => {
    const fromUrl = parseWalkshedParams(window.location.search)
    return fromUrl || new Set([5, 10, 15])
  })
  const [currentLine, setCurrentLine] = useState(null)
  const [junctionHints, setJunctionHints] = useState([])
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem('walksheds_dark_mode') === '1' } catch { return false }
  })
  const [line1Data, setLine1Data] = useState(null)
  const [line2Data, setLine2Data] = useState(null)
  const [stationsData, setStationsData] = useState(null)
  // Legend collapse: user preference (from localStorage or manual toggle) takes priority.
  // null = no preference, let auto-collapse decide based on overlap.
  const [userLegendPref, setUserLegendPref] = useState(() => {
    try {
      const stored = window.localStorage.getItem('walksheds_legend_collapsed')
      if (stored !== null) return stored === '1'
    } catch { /* private mode */ }
    return null
  })
  const [autoCollapsed, setAutoCollapsed] = useState(false)
  const legendCollapsed = userLegendPref !== null ? userLegendPref : autoCollapsed

  const toggleLegendCollapsed = useCallback(() => {
    setUserLegendPref(prev => {
      const next = prev !== null ? !prev : !autoCollapsed
      try { window.localStorage.setItem('walksheds_legend_collapsed', next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }, [autoCollapsed])

  useEffect(() => {
    try { window.localStorage.setItem('walksheds_dark_mode', darkMode ? '1' : '0') } catch { /* private mode */ }
  }, [darkMode])

  const [legendPosition, setLegendPosition] = useState('bottom-left')
  const [introVisible, setIntroVisible] = useState(() => shouldShowIntro())
  const [poiData, setPoiData] = useState({})
  const [tagCategories, setTagCategories] = useState(null)
  const [poiFilters, setPoiFilters] = useState(new Set())
  const [enabledCategories, setEnabledCategories] = useState(() => new Set(DEFAULT_ENABLED_MAIN_CATEGORIES))
  const [poiPopup, setPoiPopup] = useState(null)
  const [expandedPoiTag, setExpandedPoiTag] = useState(null)
  const mapViewRef = useRef(null)
  const selectedStationRef = useRef(null)
  const graphRef = useRef(null)
  const resolvedRef = useRef(false)
  const poisResolvedRef = useRef(false)

  const dataFetchedRef = useRef(false)
  useEffect(() => {
    if (dataFetchedRef.current) return
    dataFetchedRef.current = true
    const base = import.meta.env.BASE_URL
    fetch(`${base}line1-alignment.geojson`).then(r => r.json()).then(setLine1Data)
    fetch(`${base}line2-alignment.geojson`).then(r => r.json()).then(setLine2Data)
    fetch(`${base}all-stations.geojson`).then(r => r.json()).then(setStationsData)
    for (const cat of POI_FILES) {
      fetch(`${base}pois/${cat}.geojson`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPoiData(prev => ({ ...prev, [cat]: d })) })
    }
    fetch(`${base}pois/tag-categories.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTagCategories(d) })
  }, [])

  useEffect(() => {
    if (stationsData) graphRef.current = buildGraph(stationsData)
  }, [stationsData])

  const handleWalkshedToggle = useCallback((minutes) => {
    const next = new Set(enabledWalksheds)
    if (next.has(minutes)) next.delete(minutes)
    else next.add(minutes)
    setEnabledWalksheds(next)

    if (Object.keys(walksheds).length) {
      const map = mapViewRef.current?.getMap()
      setLegendPosition(computeLegendPosition(map, walksheds, next))
    }
  }, [enabledWalksheds, walksheds])

  const selectStation = useCallback((name, lng, lat, line) => {
    selectedStationRef.current = { name, lng, lat }
    const feat = stationsData?.features.find(f => f.properties.name === name)
    const stopCode = feat?.properties.stopCode ?? null
    const lines = feat?.properties.lines ?? line.replace('-line', '')
    setPopup({ longitude: lng, latitude: lat, name, line, stopCode, lines })
    setCurrentLine(line)
    setWalksheds({})

    // Sync URL
    if (stopCode != null) {
      const base = import.meta.env.BASE_URL
      const lineNum = line.replace('-line', '')
      const schema = tagCategories?.filter_schema
      const path = buildStationPath(lineNum, stopCode, base) + combineQuery(
        buildWalkshedParams(enabledWalksheds),
        buildPoiFilterParam(enabledCategories, poiFilters, schema, DEFAULT_ENABLED_MAIN_CATEGORIES),
      )
      window.history.replaceState(null, '', path)
    }

    if (graphRef.current && isJunction(graphRef.current, name)) {
      setJunctionHints(getJunctionHints(graphRef.current, name))
    } else {
      setJunctionHints([])
    }

    const results = {}
    Promise.all(
      WALKSHED_OPTIONS.map(async (min) => {
        const data = await fetchWalkshed(lng, lat, min)
        if (data) results[min] = data
      })
    ).then(() => {
      if (selectedStationRef.current?.name !== name) return
      setWalksheds(results)

      const bounds = getLargestEnabledBounds(results, enabledWalksheds)
      if (bounds) {
        mapViewRef.current?.fitBounds(bounds, { padding: 60, duration: 600 })
      }

      const map = mapViewRef.current?.getMap()
      setLegendPosition(computeLegendPosition(map, results, enabledWalksheds))
      setAutoCollapsed(legendOverlapsWalkshed(map, results, enabledWalksheds))
    })
  }, [stationsData, enabledWalksheds, enabledCategories, poiFilters, tagCategories])

  // Re-fit map when walkshed toggles change
  useEffect(() => {
    if (!Object.keys(walksheds).length) return
    const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
    if (bounds) {
      mapViewRef.current?.fitBounds(bounds, { padding: 60, duration: 600 })
    }
  }, [enabledWalksheds, walksheds])

  // Compute POIs visible within the largest enabled walkshed
  const walkshedPois = useMemo(() => {
    const hasWalksheds = Object.keys(walksheds).length > 0
    const hasPoiData = Object.keys(poiData).length > 0
    if (!hasWalksheds || !hasPoiData) return { type: 'FeatureCollection', features: [] }

    // Use the largest enabled walkshed as the clipping polygon
    const sorted = [...enabledWalksheds].sort((a, b) => b - a)
    let walkshedFC = null
    for (const min of sorted) {
      if (walksheds[min]) { walkshedFC = walksheds[min]; break }
    }
    if (!walkshedFC) return { type: 'FeatureCollection', features: [] }

    const clipped = POI_FILES
      .map(cat => poiData[cat] ? filterPOIsInWalkshed(poiData[cat], walkshedFC) : null)
      .filter(Boolean)
    return mergeFeatureCollections(...clipped)
  }, [walksheds, enabledWalksheds, poiData])

  const tagColors = useMemo(() => {
    if (!tagCategories) return {}
    const out = {}
    for (const [tag, catId] of Object.entries(tagCategories.tag_to_category)) {
      const color = tagCategories.categories[catId]?.color
      if (color) out[tag] = color
    }
    return out
  }, [tagCategories])

  const availableTags = useMemo(
    () => getAvailableTags(walkshedPois.features, tagColors),
    [walkshedPois, tagColors],
  )

  const mainCategoriesById = useMemo(() => {
    const out = {}
    for (const c of MAIN_POI_CATEGORIES) out[c.id] = c
    return out
  }, [])

  const visiblePois = useMemo(() => {
    const filtered = filterByMainCategoriesAndTags(
      walkshedPois.features,
      enabledCategories,
      poiFilters,
      mainCategoriesById,
    )
    return { type: 'FeatureCollection', features: filtered }
  }, [walkshedPois, enabledCategories, poiFilters, mainCategoriesById])

  const handleToggleCategory = useCallback((catId) => {
    setEnabledCategories(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }, [])

  const handleAddPoiFilter = useCallback((tag) => {
    setPoiFilters(prev => new Set([...prev, tag]))
  }, [])

  const fitToWalkshed = useCallback(() => {
    setPoiPopup(null)
    const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
    if (bounds) {
      mapViewRef.current?.fitBounds(bounds, { padding: 60, duration: 600 })
    }
  }, [walksheds, enabledWalksheds])

  const handleRemovePoiFilter = useCallback((tag) => {
    setPoiFilters(prev => {
      const next = new Set(prev)
      next.delete(tag)
      if (next.size === 0) fitToWalkshed()
      return next
    })
  }, [fitToWalkshed])

  const handleClearPoiFilters = useCallback(() => {
    setPoiFilters(new Set())
    setEnabledCategories(new Set())
    fitToWalkshed()
  }, [fitToWalkshed])

  const handlePoiClick = useCallback((feature) => {
    const props = feature.properties
    const [lng, lat] = feature.geometry.coordinates
    setPoiPopup({
      longitude: lng,
      latitude: lat,
      name: props.name,
      category: props.category,
      tags: typeof props.tags === 'string' ? JSON.parse(props.tags) : props.tags,
      website: props.website,
      address: props.address,
    })
  }, [])

  const handlePoiSelect = useCallback((feature) => {
    const [lng, lat] = feature.geometry.coordinates
    const map = mapViewRef.current?.getMap()
    if (map) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 800 })
    }
    handlePoiClick(feature)
  }, [handlePoiClick])

  const handlePoiClose = useCallback(() => setPoiPopup(null), [])

  // Hand keyboard focus from the search box back to the map canvas so the
  // user can pan/zoom with arrow keys right after committing a selection.
  const focusMap = useCallback(() => {
    mapViewRef.current?.getMap()?.getCanvas()?.focus()
  }, [])

  const handleDeselect = useCallback(() => {
    selectedStationRef.current = null
    setPopup(null)
    setWalksheds({})
    setCurrentLine(null)
    setJunctionHints([])
    setPoiPopup(null)
    setAutoCollapsed(false)
    setLegendPosition('bottom-left')
    window.history.replaceState(null, '', import.meta.env.BASE_URL)
  }, [])

  // Resolve deep link on initial load
  useEffect(() => {
    if (!stationsData || resolvedRef.current) return
    resolvedRef.current = true
    const base = import.meta.env.BASE_URL
    const parsed = parseStationPath(window.location.pathname, base)
    if (!parsed) return
    const station = findStationByCode(stationsData, parsed.line, parsed.stopCode)
    if (!station) return
    // Defer to avoid synchronous setState in effect body (lint: react-hooks/set-state-in-effect)
    queueMicrotask(() => selectStation(station.name, station.lng, station.lat, station.line))
  }, [stationsData, selectStation])

  // Sync walkshed + POI filter query params when toggles change
  useEffect(() => {
    if (!selectedStationRef.current) return
    const feat = stationsData?.features.find(f => f.properties.name === selectedStationRef.current.name)
    if (!feat) return
    const base = import.meta.env.BASE_URL
    const lineNum = currentLine?.replace('-line', '')
    if (!lineNum) return
    const schema = tagCategories?.filter_schema
    const path = buildStationPath(lineNum, feat.properties.stopCode, base) + combineQuery(
      buildWalkshedParams(enabledWalksheds),
      buildPoiFilterParam(enabledCategories, poiFilters, schema, DEFAULT_ENABLED_MAIN_CATEGORIES),
    )
    window.history.replaceState(null, '', path)
  }, [enabledWalksheds, enabledCategories, poiFilters, stationsData, currentLine, tagCategories])

  // Restore POI filter state from `?pois=` once the schema is loaded.
  // Runs once; does not call replaceState so the original URL stays until the
  // user makes a change. Defers setState to a microtask to satisfy
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!tagCategories || poisResolvedRef.current) return
    poisResolvedRef.current = true
    const parsed = parsePoiFilterParam(window.location.search, tagCategories.filter_schema)
    if (!parsed) return
    queueMicrotask(() => {
      if (parsed.categories.size) setEnabledCategories(parsed.categories)
      if (parsed.tags.size) setPoiFilters(parsed.tags)
    })
  }, [tagCategories])

  useNavigation({ graphRef, selectedStationRef, currentLine, selectStation })

  // Keyboard shortcuts
  useEffect(() => {
    const WALKSHED_KEYS = { '1': 5, '2': 10, '3': 15 }
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'd') setDarkMode(d => !d)
      else if (e.key === 'l') toggleLegendCollapsed()
      else if (WALKSHED_KEYS[e.key]) handleWalkshedToggle(WALKSHED_KEYS[e.key])
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleWalkshedToggle, toggleLegendCollapsed])

  const introControls = {
    selectByName: useCallback((name) => {
      const feat = stationsData?.features.find(f => f.properties.name === name)
      if (!feat) return
      const [lng, lat] = feat.geometry.coordinates
      selectStation(name, lng, lat, feat.properties.line)
    }, [stationsData, selectStation]),
    setEnabledWalksheds: useCallback((set) => setEnabledWalksheds(set), []),
    flyToOverview: useCallback(() => {
      handleDeselect()
      mapViewRef.current?.getMap()?.flyTo({
        center: SEATTLE_CENTER,
        zoom: SEATTLE_ZOOM,
        duration: 1500,
      })
    }, [handleDeselect]),
  }

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <MapView
        ref={mapViewRef}
        darkMode={darkMode}
        walksheds={walksheds}
        enabledWalksheds={enabledWalksheds}
        popup={popup}
        junctionHints={junctionHints}
        line1Data={line1Data}
        line2Data={line2Data}
        stationsData={stationsData}
        onStationClick={selectStation}
        onDeselect={handleDeselect}
        visiblePois={visiblePois}
        poiPopup={poiPopup}
        onPoiClick={handlePoiClick}
        onPoiClose={handlePoiClose}
        onPoiTagClick={handleAddPoiFilter}
      />

      {Object.keys(poiData).length > 0 && (
        <POISearch
          availableTags={availableTags}
          activeFilters={poiFilters}
          poiFeatures={walkshedPois.features}
          expandedTag={expandedPoiTag}
          onExpandTag={setExpandedPoiTag}
          onAddFilter={handleAddPoiFilter}
          onRemoveFilter={handleRemovePoiFilter}
          onClearFilters={handleClearPoiFilters}
          onPoiSelect={handlePoiSelect}
          mainCategories={MAIN_POI_CATEGORIES}
          enabledCategories={enabledCategories}
          onToggleCategory={handleToggleCategory}
          tagAliases={tagCategories?.filter_schema?.aliases}
          onCommit={focusMap}
        />
      )}

      <LineLegend
        lineColors={LINE_COLORS}
        enabledWalksheds={enabledWalksheds}
        walkshedAccent={WALKSHED_ACCENT_LIGHT}
        onWalkshedToggle={handleWalkshedToggle}
        darkMode={darkMode}
        onDarkModeToggle={() => setDarkMode(d => !d)}
        collapsed={legendCollapsed}
        onToggleCollapse={() => toggleLegendCollapsed()}
        position={legendPosition}
      />

      {introVisible && stationsData && (
        <Intro
          controls={introControls}
          onClose={() => setIntroVisible(false)}
        />
      )}
    </div>
  )
}
