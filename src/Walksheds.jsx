import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { buildGraph, isJunction, getJunctionHints, getTerminusInfo, getSwipeHint } from './routeGraph'
import { fetchWalkshed, getLargestEnabledBounds, computeSnapTarget } from './mapbox'
import { WALKSHED_OPTIONS, LINE_COLORS, WALKSHED_ACCENT_LIGHT, MAIN_POI_CATEGORIES, DEFAULT_ENABLED_MAIN_CATEGORIES, DEFAULT_ENABLED_CATEGORY_TAGS } from './constants'
import { parseStationPath, buildStationPath, findStationByCode, parseWalkshedParams, buildWalkshedParams, combineQuery } from './deepLink'
import { buildPoiFilterParam, parsePoiFilterParam } from './poiFilterUrl'
import { filterPOIsInWalkshed, filterByCategoriesAndFilters, getAvailableTags } from './poiUtils'
import { loadTileIndex, loadPoisForWalkshed } from './poiTiles'
import { useNavigation } from './useNavigation'
import { findNearestStation, MAX_SNAP_METERS } from './locate'
import { useCompassRotation } from './useCompass'
import MapView from './MapView'
import LineLegend from './LineLegend'
import POISearch from './POISearch'
import HintOverlay from './HintOverlay'
import { shouldShowHints, markHintsSeen } from './hintsState'
import './walksheds.css'

function computeSystemBounds(stationsData) {
  if (!stationsData?.features?.length) return null
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const f of stationsData.features) {
    const [lng, lat] = f.geometry.coordinates
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!isFinite(minLng)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

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
  const [terminusInfo, setTerminusInfo] = useState(null)
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem('walksheds_dark_mode') === '1' } catch { return false }
  })
  const [units, setUnits] = useState(() => {
    try {
      const stored = window.localStorage.getItem('walksheds_units')
      return stored === 'imperial' ? 'imperial' : 'metric'
    } catch { return 'metric' }
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

  useEffect(() => {
    try { window.localStorage.setItem('walksheds_units', units) } catch { /* private mode */ }
  }, [units])

  const [legendPosition, setLegendPosition] = useState('bottom-left')
  const [hintsVisible, setHintsVisible] = useState(() => shouldShowHints())
  const [tileIndex, setTileIndex] = useState(null)
  const [walkshedPois, setWalkshedPois] = useState({ type: 'FeatureCollection', features: [] })
  const [tagCategories, setTagCategories] = useState(null)
  // Three independent state sets per the category/filter/spotlight model
  // (see README.md → "POI selection logic"):
  //   - enabledSpotlights: curated pill ids from MAIN_POI_CATEGORIES
  //   - activeCategories:  user-added POI-type tags (shown as pills)
  //   - activeFilters:     user-added attribute tags (shown as checkboxes)
  const [activeCategories, setActiveCategories] = useState(new Set())
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [enabledSpotlights, setEnabledSpotlights] = useState(() => new Set(DEFAULT_ENABLED_MAIN_CATEGORIES))
  const [poiPopup, setPoiPopup] = useState(null)
  const [expandedPoiTag, setExpandedPoiTag] = useState(null)
  // Z-order toggle: when the user opens a chip's POI list, lift the search/list
  // above any open popup; clicking the popup body or a POI dot puts the popup
  // back on top. Default state is popup-on-top to match historical behavior.
  const [listOnTop, setListOnTop] = useState(false)
  const mapViewRef = useRef(null)
  const selectedStationRef = useRef(null)
  // False right after a station is selected (map programmatically framed to its
  // walkshed), flipped true once the user zooms in to inspect it. Lets swipes
  // on a fresh station view navigate to the neighbor the hint promises instead
  // of being eaten by the in-walkshed snap-back.
  const userMovedSinceSelectRef = useRef(false)
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
    // POIs stream per-walkshed from spatial tiles (see poiTiles.js); only the
    // small tile index is loaded upfront instead of the full 11.7 MB dataset.
    loadTileIndex(base).then(setTileIndex).catch(() => {})
    fetch(`${base}pois/tag-categories.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTagCategories(d) })
  }, [])

  // Build the adjacency graph once per stations payload. Kept both as a
  // memoized value (for render-time reads like the swipe hint) and mirrored
  // into graphRef so the navigation/selection event handlers can reach it
  // without re-subscribing.
  const graph = useMemo(() => (stationsData ? buildGraph(stationsData) : null), [stationsData])
  useEffect(() => {
    graphRef.current = graph
  }, [graph])

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
    // A new selection re-frames the map programmatically; treat the view as
    // "untouched" until the user zooms in again.
    userMovedSinceSelectRef.current = false
    const feat = stationsData?.features.find(f => f.properties.name === name)
    const stopCode = feat?.properties.stopCode ?? null
    const lines = feat?.properties.lines ?? line.replace('-line', '')
    setPopup({ longitude: lng, latitude: lat, name, line, stopCode, lines })
    setCurrentLine(line)
    setWalksheds({})
    // Any in-flight POI popup belongs to the previous station — drop it.
    setPoiPopup(null)

    // Sync URL
    if (stopCode != null) {
      const base = import.meta.env.BASE_URL
      const lineNum = line.replace('-line', '')
      const schema = tagCategories?.filter_schema
      const mergedTags = new Set([...activeCategories, ...activeFilters])
      const path = buildStationPath(lineNum, stopCode, base) + combineQuery(
        buildWalkshedParams(enabledWalksheds),
        buildPoiFilterParam(enabledSpotlights, mergedTags, schema, DEFAULT_ENABLED_MAIN_CATEGORIES, DEFAULT_ENABLED_CATEGORY_TAGS),
      )
      window.history.replaceState(null, '', path)
    }

    if (graphRef.current && isJunction(graphRef.current, name)) {
      setJunctionHints(getJunctionHints(graphRef.current, name))
      setTerminusInfo(null)
    } else {
      setJunctionHints([])
      setTerminusInfo(graphRef.current ? getTerminusInfo(graphRef.current, name) : null)
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
  }, [stationsData, enabledWalksheds, enabledSpotlights, activeCategories, activeFilters, tagCategories])

  // Re-fit map when walkshed toggles change
  useEffect(() => {
    if (!Object.keys(walksheds).length) return
    const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
    if (bounds) {
      mapViewRef.current?.fitBounds(bounds, { padding: 60, duration: 600 })
    }
  }, [enabledWalksheds, walksheds])

  // The largest enabled walkshed polygon — the clipping boundary for POIs.
  const activeWalkshedFC = useMemo(() => {
    const sorted = [...enabledWalksheds].sort((a, b) => b - a)
    for (const min of sorted) {
      if (walksheds[min]) return walksheds[min]
    }
    return null
  }, [walksheds, enabledWalksheds])

  // Stream POIs for the active walkshed: load the overlapping spatial tiles,
  // then point-in-polygon clip. Async (tiles fetched on demand) — results land
  // in walkshedPois state; the empty case resolves synchronously to [].
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!tileIndex || !activeWalkshedFC) {
        if (!cancelled) setWalkshedPois({ type: 'FeatureCollection', features: [] })
        return
      }
      const base = import.meta.env.BASE_URL
      // Station key ({lines}-{stopCode}) lets the tile loader use the build's
      // precomputed station->tiles lookup instead of recomputing the bbox.
      const stationKey = popup?.stopCode != null ? `${popup.lines}-${popup.stopCode}` : null
      const features = await loadPoisForWalkshed(base, activeWalkshedFC, tileIndex, stationKey)
      if (!cancelled) {
        setWalkshedPois(filterPOIsInWalkshed({ type: 'FeatureCollection', features }, activeWalkshedFC))
      }
    }
    run()
    return () => { cancelled = true }
  }, [activeWalkshedFC, tileIndex, popup])

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

  // Global (city-wide) tag list, for the search fallback when the typed term
  // doesn't match anything in the current walkshed — surfaces the tag as
  // "not in walkshed" instead of an empty dropdown. Derived from the full tag
  // vocabulary (tag-categories.json) so it needs no full-POI load; counts are
  // unused on this path so a placeholder count of 0 is fine.
  const globalAvailableTags = useMemo(() => {
    if (!tagCategories?.tag_to_category) return []
    return Object.keys(tagCategories.tag_to_category)
      .map(tag => ({ tag, count: 0, color: tagColors[tag] || null }))
  }, [tagCategories, tagColors])

  const spotlightsById = useMemo(() => {
    const out = {}
    for (const c of MAIN_POI_CATEGORIES) out[c.id] = c
    return out
  }, [])

  // Set of category ids whose tags should be treated as cross-cutting filters
  // (rendered as checkboxes, AND'd on top of the category union). Sourced from
  // tag-categories.json so the build pipeline owns the boundary.
  const filterCategoryIds = useMemo(
    () => new Set(tagCategories?.filter_tag_categories || []),
    [tagCategories],
  )

  // Decide whether a tag is a "filter" (attribute) or "category" (POI type)
  // by looking up its bucket in the manifest. Unknown tags default to
  // category — the safer/more visible bucket.
  const isFilterTag = useCallback((tag) => {
    const catId = tagCategories?.tag_to_category?.[tag]
    return catId ? filterCategoryIds.has(catId) : false
  }, [tagCategories, filterCategoryIds])

  const visiblePois = useMemo(() => {
    const filtered = filterByCategoriesAndFilters(walkshedPois.features, {
      enabledSpotlights,
      activeCategories,
      activeFilters,
      spotlightsById,
    })
    return { type: 'FeatureCollection', features: filtered }
  }, [walkshedPois, enabledSpotlights, activeCategories, activeFilters, spotlightsById])

  const handleToggleCategory = useCallback((catId) => {
    setEnabledSpotlights(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }, [])

  // Route a tag from the search dropdown into the right bucket. Filter-kind
  // tags become checkboxes; category-kind tags become pills.
  const handleAddPoiFilter = useCallback((tag) => {
    if (isFilterTag(tag)) {
      setActiveFilters(prev => new Set([...prev, tag]))
    } else {
      setActiveCategories(prev => new Set([...prev, tag]))
    }
  }, [isFilterTag])

  const fitToWalkshed = useCallback(() => {
    setPoiPopup(null)
    const bounds = getLargestEnabledBounds(walksheds, enabledWalksheds)
    if (bounds) {
      mapViewRef.current?.fitBounds(bounds, { padding: 60, duration: 600 })
    }
  }, [walksheds, enabledWalksheds])

  const handleRemovePoiFilter = useCallback((tag) => {
    const setter = isFilterTag(tag) ? setActiveFilters : setActiveCategories
    setter(prev => {
      const next = new Set(prev)
      next.delete(tag)
      return next
    })
  }, [isFilterTag])

  const handleClearPoiFilters = useCallback(() => {
    setActiveCategories(new Set())
    setActiveFilters(new Set())
    setEnabledSpotlights(new Set())
    setExpandedPoiTag(null)
    fitToWalkshed()
  }, [fitToWalkshed])

  // Single POI click path: whether the user tapped a dot on the map or
  // picked a place from the per-tag list, fly to it, open the popup, and
  // collapse the list so the popup is the foreground focus.
  const handlePoiClick = useCallback((feature) => {
    const props = feature.properties
    const [lng, lat] = feature.geometry.coordinates
    const map = mapViewRef.current?.getMap()
    if (map) {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 800 })
    }
    setPoiPopup({
      longitude: lng,
      latitude: lat,
      id: props.id,
      name: props.name,
      category: props.category,
      tags: typeof props.tags === 'string' ? JSON.parse(props.tags) : props.tags,
      website: props.website,
      address: props.address,
      phone: props.phone,
      hours: props.hours,
      stations: typeof props.stations === 'string' ? JSON.parse(props.stations) : props.stations,
    })
    setExpandedPoiTag(null)
    setListOnTop(false)
  }, [])

  // Click handler for a station row inside a POI popup: jump to that station.
  const handlePopupStationClick = useCallback((s) => {
    if (!stationsData) return
    const feat = stationsData.features.find(f =>
      f.properties.stopCode === s.stopCode && (f.properties.lines || '').trim() === (s.lines || '').trim()
    )
    if (!feat) return
    const [lng, lat] = feat.geometry.coordinates
    selectStation(feat.properties.name, lng, lat, feat.properties.line)
  }, [stationsData, selectStation])

  // Closing the popup re-frames the walkshed at its original padding so the
  // user lands back in "station view" instead of stuck zoomed on the POI.
  const handlePoiClose = useCallback(() => fitToWalkshed(), [fitToWalkshed])

  // Expanding a chip's POI list raises the list above any open popup. Passing
  // null collapses the list; the z-order doesn't matter once the list is gone
  // but we clear the flag to keep state tidy.
  const handleExpandPoiTag = useCallback((tag) => {
    setExpandedPoiTag(tag)
    setListOnTop(tag != null)
  }, [])

  // Any click inside the popup (or the POI dot on the map) brings the popup
  // back to the top. Wired into POILayer's popup container.
  const handlePopupFocus = useCallback(() => setListOnTop(false), [])

  // Mark the framed station view as "touched" once the user zooms in, so the
  // swipe-to-navigate carve-out in handleScrollNavigationAttempt yields to the
  // in-walkshed snap-back from then on (until the next selection re-frames).
  const handleUserInteract = useCallback(() => {
    userMovedSinceSelectRef.current = true
  }, [])

  // Hand keyboard focus from the search box back to the map canvas so the
  // user can pan/zoom with arrow keys right after committing a selection.
  const focusMap = useCallback(() => {
    mapViewRef.current?.getMap()?.getCanvas()?.focus()
  }, [])

  // A station picked from the search dropdown behaves exactly like a click
  // on its map icon: fly there, open the pill, fetch the walksheds.
  const handleStationSearchSelect = useCallback((feature) => {
    const [lng, lat] = feature.geometry.coordinates
    selectStation(feature.properties.name, lng, lat, feature.properties.line)
  }, [selectStation])

  // Locate control (issue #16). The first fix after the user activates
  // tracking snaps to the nearest station — enabling every walkshed band —
  // when the fix lands inside the Link corridor; later fixes from the same
  // tracking session only move the puck. Live compass rotation runs for
  // the whole tracking session.
  const geoSnapPendingRef = useRef(false)
  const compass = useCompassRotation(useCallback(() => mapViewRef.current?.getMap(), []))

  const handleTrackUserLocationStart = useCallback(() => {
    geoSnapPendingRef.current = true
    compass.start()
  }, [compass])

  const handleTrackUserLocationEnd = useCallback(() => {
    geoSnapPendingRef.current = false
    compass.stop()
  }, [compass])

  const handleGeolocate = useCallback((position) => {
    if (!geoSnapPendingRef.current || !stationsData) return
    geoSnapPendingRef.current = false
    const { longitude, latitude } = position.coords
    const nearest = findNearestStation(stationsData, longitude, latitude)
    if (!nearest || nearest.distanceMeters > MAX_SNAP_METERS) return
    setEnabledWalksheds(new Set(WALKSHED_OPTIONS))
    const [lng, lat] = nearest.feature.geometry.coordinates
    selectStation(nearest.feature.properties.name, lng, lat, nearest.feature.properties.line)
  }, [stationsData, selectStation])

  // Trackpad / wheel scroll within the walkshed snaps back to the station
  // instead of transitioning to an adjacent one — mirroring the pan-snap on
  // dragend so wheel input feels the same as drag input. A POI popup, if
  // open, is dismissed along the way (the scroll gesture reads as "back to
  // station view"). Outside the walkshed, scroll-to-navigate behaves as
  // before so users can still flick through stations from an overview.
  const handleScrollNavigationAttempt = useCallback(() => {
    const map = mapViewRef.current?.getMap()
    if (!map) return true
    // On a freshly-framed station view (the user hasn't zoomed in since
    // selecting), let the swipe/scroll navigate to the adjacent station — this
    // is the gesture the swipe hint teaches. Snap-back only applies once the
    // user has zoomed in to explore. A POI popup still takes precedence.
    if (!poiPopup && !userMovedSinceSelectRef.current) return true
    const center = map.getCenter()
    // Use the helper with poiPopup omitted so the target is always station
    // coords — the wheel snap goes to station regardless of popup state.
    const target = computeSnapTarget({
      mapCenter: [center.lng, center.lat],
      walksheds,
      enabledWalksheds,
      popup,
      poiPopup: null,
    })
    if (!target) return true
    if (poiPopup) {
      fitToWalkshed()
    } else {
      map.easeTo({ center: target, duration: 250 })
    }
    return false
  }, [walksheds, enabledWalksheds, popup, poiPopup, fitToWalkshed])

  // Resolve deep link on initial load, or default to Westlake with a
  // full-system overview that flies in.
  useEffect(() => {
    if (!stationsData || resolvedRef.current) return
    resolvedRef.current = true
    const base = import.meta.env.BASE_URL
    const parsed = parseStationPath(window.location.pathname, base)
    if (parsed) {
      const station = findStationByCode(stationsData, parsed.line, parsed.stopCode)
      if (!station) return
      queueMicrotask(() => selectStation(station.name, station.lng, station.lat, station.line))
      return
    }
    // No deep link: snap to system-wide overview, then fly into Westlake.
    const station = findStationByCode(stationsData, '1', 50)
    if (!station) return
    const bounds = computeSystemBounds(stationsData)
    if (bounds) {
      mapViewRef.current?.fitBounds(bounds, { padding: 80, duration: 0 })
    }
    const t = setTimeout(() => {
      selectStation(station.name, station.lng, station.lat, station.line)
    }, 900)
    return () => clearTimeout(t)
  }, [stationsData, selectStation])

  // Sync walkshed + POI filter query params when toggles change. The URL
  // codec uses a single tag namespace, so categories and filters are merged
  // here and routed back on parse.
  useEffect(() => {
    if (!selectedStationRef.current) return
    const feat = stationsData?.features.find(f => f.properties.name === selectedStationRef.current.name)
    if (!feat) return
    const base = import.meta.env.BASE_URL
    const lineNum = currentLine?.replace('-line', '')
    if (!lineNum) return
    const schema = tagCategories?.filter_schema
    const mergedTags = new Set([...activeCategories, ...activeFilters])
    const path = buildStationPath(lineNum, feat.properties.stopCode, base) + combineQuery(
      buildWalkshedParams(enabledWalksheds),
      buildPoiFilterParam(enabledSpotlights, mergedTags, schema, DEFAULT_ENABLED_MAIN_CATEGORIES),
    )
    window.history.replaceState(null, '', path)
  }, [enabledWalksheds, enabledSpotlights, activeCategories, activeFilters, stationsData, currentLine, tagCategories])

  // Restore POI filter state from `?pois=` once the schema is loaded.
  // Splits the parsed tag set into categories vs filters by the tag's
  // category-bucket — backward-compatible with URLs minted before this split.
  // When no `?pois=` is present, seed the default category pills (coffee +
  // park) so the empty-state landing on Westlake shows a populated pill row.
  // Filter checkboxes are left empty — users discover them via the overlay hint.
  useEffect(() => {
    if (!tagCategories || poisResolvedRef.current) return
    poisResolvedRef.current = true
    const parsed = parsePoiFilterParam(window.location.search, tagCategories.filter_schema)
    queueMicrotask(() => {
      if (parsed) {
        if (parsed.categories.size) setEnabledSpotlights(parsed.categories)
        if (parsed.tags.size) {
          const cats = new Set()
          const filts = new Set()
          for (const t of parsed.tags) {
            (isFilterTag(t) ? filts : cats).add(t)
          }
          if (cats.size) setActiveCategories(cats)
          if (filts.size) setActiveFilters(filts)
        }
      } else {
        setActiveCategories(new Set(DEFAULT_ENABLED_CATEGORY_TAGS))
      }
    })
  }, [tagCategories, isFilterTag])

  useNavigation({
    graphRef,
    selectedStationRef,
    currentLine,
    selectStation,
    onBeforeNavigate: handleScrollNavigationAttempt,
  })

  // Keyboard shortcuts
  useEffect(() => {
    const WALKSHED_KEYS = { '1': 5, '2': 10, '3': 15 }
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'd') setDarkMode(d => !d)
      else if (e.key === 'l') toggleLegendCollapsed()
      else if (e.key === 'u') setUnits(u => u === 'imperial' ? 'metric' : 'imperial')
      else if (WALKSHED_KEYS[e.key]) handleWalkshedToggle(WALKSHED_KEYS[e.key])
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleWalkshedToggle, toggleLegendCollapsed])

  // Dismiss hints on any click. Armed after a short delay so the auto-fly
  // into Westlake (and any synthetic map events around it) doesn't swallow
  // the hints on first paint. Elements marked `data-hint-keep` (the legend
  // collapse/expand chevrons) are opted out so toggling the legend doesn't
  // dismiss the hint that points at it.
  useEffect(() => {
    if (!hintsVisible) return
    let armed = false
    const armT = setTimeout(() => { armed = true }, 250)
    const onClick = (e) => {
      if (!armed) return
      if (e.target?.closest?.('[data-hint-keep]')) return
      markHintsSeen()
      setHintsVisible(false)
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => {
      clearTimeout(armT)
      document.removeEventListener('click', onClick, { capture: true })
    }
  }, [hintsVisible])

  // Onward station for the swipe hint, recomputed whenever the selected
  // station (popup) or current line changes so the label tracks the user as
  // they ride along the line. Only needed while the hints are on screen.
  const swipeHint = useMemo(() => {
    if (!hintsVisible || !popup || !graph) return null
    return getSwipeHint(graph, popup.name, currentLine)
  }, [hintsVisible, popup, currentLine, graph])

  const handleHintsToggle = useCallback(() => {
    setHintsVisible(v => {
      const next = !v
      if (!next) markHintsSeen()
      return next
    })
  }, [])

  return (
    <div className={`app ${darkMode ? 'dark' : ''} ${listOnTop ? 'list-on-top' : ''}`}>
      <MapView
        ref={mapViewRef}
        darkMode={darkMode}
        walksheds={walksheds}
        enabledWalksheds={enabledWalksheds}
        popup={popup}
        junctionHints={junctionHints}
        terminusInfo={terminusInfo}
        line1Data={line1Data}
        line2Data={line2Data}
        stationsData={stationsData}
        onStationClick={selectStation}
        visiblePois={visiblePois}
        poiPopup={poiPopup}
        onPoiClick={handlePoiClick}
        onPoiClose={handlePoiClose}
        onPoiTagClick={handleAddPoiFilter}
        onPopupStationClick={handlePopupStationClick}
        onPopupFocus={handlePopupFocus}
        onUserInteract={handleUserInteract}
        onGeolocate={handleGeolocate}
        onTrackUserLocationStart={handleTrackUserLocationStart}
        onTrackUserLocationEnd={handleTrackUserLocationEnd}
        units={units}
      />

      {tagCategories && (
        <POISearch
          availableTags={availableTags}
          globalAvailableTags={globalAvailableTags}
          activeCategories={activeCategories}
          activeFilters={activeFilters}
          poiFeatures={walkshedPois.features}
          expandedTag={expandedPoiTag}
          onExpandTag={handleExpandPoiTag}
          onAddFilter={handleAddPoiFilter}
          onRemoveFilter={handleRemovePoiFilter}
          onClearFilters={handleClearPoiFilters}
          onPoiSelect={handlePoiClick}
          mainCategories={MAIN_POI_CATEGORIES}
          enabledCategories={enabledSpotlights}
          onToggleCategory={handleToggleCategory}
          tagAliases={tagCategories?.filter_schema?.aliases}
          onCommit={focusMap}
          stations={stationsData?.features}
          onStationSelect={handleStationSearchSelect}
        />
      )}

      <LineLegend
        lineColors={LINE_COLORS}
        enabledWalksheds={enabledWalksheds}
        walkshedAccent={WALKSHED_ACCENT_LIGHT}
        onWalkshedToggle={handleWalkshedToggle}
        darkMode={darkMode}
        onDarkModeToggle={() => setDarkMode(d => !d)}
        units={units}
        onUnitsToggle={() => setUnits(u => u === 'imperial' ? 'metric' : 'imperial')}
        collapsed={legendCollapsed}
        onToggleCollapse={() => toggleLegendCollapsed()}
        onHintsToggle={handleHintsToggle}
        position={legendPosition}
      />

      {hintsVisible && stationsData && (
        <HintOverlay
          legendPosition={legendPosition}
          legendCollapsed={legendCollapsed}
          hasActiveFilters={activeFilters.size > 0}
          swipeHint={swipeHint}
        />
      )}
    </div>
  )
}
