import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import Map, { Source, Layer } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { registerStationIcons } from './stationIcons'
import { MAPBOX_TOKEN, SEATTLE_CENTER, SEATTLE_ZOOM, LINE_COLORS, POI_INTERACTIVE_LAYERS } from './constants'
import { computeSnapTarget } from './mapbox'
import WalkshedLayers from './WalkshedLayers'
import POILayer from './POILayer'
import StationPill from './StationPill'

const MapView = forwardRef(function MapView({
  darkMode,
  walksheds,
  enabledWalksheds,
  popup,
  junctionHints,
  terminusInfo,
  line1Data,
  line2Data,
  stationsData,
  onStationClick,
  visiblePois,
  poiPopup,
  onPoiClick,
  onPoiClose,
  onPoiTagClick,
  onPopupStationClick,
  onPopupFocus,
  units,
}, ref) {
  const mapRef = useRef(null)
  const isDraggingRef = useRef(false)
  const mapLoadedRef = useRef(false)
  const iconsReadyRef = useRef(false)

  // Expose fitBounds and getMap to parent
  useImperativeHandle(ref, () => ({
    fitBounds: (bounds, opts) => mapRef.current?.fitBounds(bounds, opts),
    getMap: () => mapRef.current?.getMap(),
  }))

  // Track map loaded + icons ready for conditional rendering
  const [mapLoaded, setMapLoaded] = useState(false)
  const [iconsReady, setIconsReady] = useState(false)

  const handleMapLoad = useCallback(() => {
    mapLoadedRef.current = true
    setMapLoaded(true)
    const map = mapRef.current?.getMap()
    if (map) {
      map.setTerrain(null)
    }
    if (import.meta.env.DEV) {
      window.__mapForTest = map
    }
  }, [])

  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current?.getMap()
    if (!map) return
    registerStationIcons(map).then(() => {
      iconsReadyRef.current = true
      setIconsReady(true)
    })
  }, [mapLoaded])

  // Apply dark/light mode
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded) return
    map.setConfigProperty('basemap', 'lightPreset', darkMode ? 'dusk' : 'day')
  }, [darkMode, mapLoaded])

  // Hide basemap POI labels when our POI layer is active
  const hasWalksheds = Object.keys(walksheds).length > 0
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded) return
    map.setConfigProperty('basemap', 'showPointOfInterestLabels', !hasWalksheds)
  }, [hasWalksheds, mapLoaded])

  // Re-pin POI and station layers to the top after any walkshed change.
  // Mapbox adds new layers at the top of the stack, so the freshly-mounted
  // walkshed Sources (which mount when the user picks a station, toggles
  // a band, or switches dark mode — the latter changes the source IDs)
  // would otherwise sit above the station icons. JSX order alone doesn't
  // fix this because by the time walksheds mount, station-circles was
  // already added. The effect runs after the commit so the new walkshed
  // layers are already in the stack when we re-order.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded) return
    for (const id of ['poi-circles', 'poi-labels', 'station-circles']) {
      if (map.getLayer(id)) map.moveLayer(id)
    }
  }, [walksheds, enabledWalksheds, mapLoaded, iconsReady, darkMode])

  const handleDragStart = useCallback(() => { isDraggingRef.current = true }, [])
  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    // Snap the map back to the active context (POI if a popup is centered,
    // otherwise the station) when the user's pan ended inside the walkshed.
    // dragend is user-only — programmatic flyTo / fitBounds don't fire it,
    // so no recursion guard is needed.
    const map = mapRef.current?.getMap?.()
    if (!map) return
    const center = map.getCenter()
    const target = computeSnapTarget({
      mapCenter: [center.lng, center.lat],
      walksheds,
      enabledWalksheds,
      popup,
      poiPopup,
    })
    if (target) {
      map.easeTo({ center: target, duration: 250 })
    }
  }, [walksheds, enabledWalksheds, popup, poiPopup])

  const handleMapClick = useCallback((e) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      return
    }
    const features = e.features
    if (features && features.length > 0) {
      const f = features[0]
      // POI click
      if (f.layer?.id && POI_INTERACTIVE_LAYERS.includes(f.layer.id)) {
        onPoiClick(f)
        return
      }
      // Station click
      if (f.properties?.name && f.properties?.line) {
        onStationClick(f.properties.name, e.lngLat.lng, e.lngLat.lat, f.properties.line)
        return
      }
    }
    // Empty-map click: keep the station/walkshed (walkshed stays open until
    // the user picks another station) but dismiss any open POI popup so the
    // user gets back to station view. Doing this here rather than via the
    // Popup's closeOnClick avoids a race where a fresh POI click would both
    // open a new popup AND immediately close it.
    onPoiClose?.()
  }, [onStationClick, onPoiClick, onPoiClose])

  const handleMouseEnter = useCallback(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = 'pointer'
  }, [])

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = ''
  }, [])

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: SEATTLE_CENTER[0],
        latitude: SEATTLE_CENTER[1],
        zoom: SEATTLE_ZOOM,
      }}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/standard"
      mapboxAccessToken={MAPBOX_TOKEN}
      interactiveLayerIds={mapLoaded ? ['station-circles', ...POI_INTERACTIVE_LAYERS] : []}
      onClick={handleMapClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onLoad={handleMapLoad}
      projection="mercator"
      config={{
        basemap: {
          theme: 'default',
          lightPreset: 'day',
          showPointOfInterestLabels: true,
          densityPointOfInterestLabels: 5,
          show3dObjects: false,
        },
      }}
    >
      <WalkshedLayers
        walksheds={walksheds}
        enabledWalksheds={enabledWalksheds}
        darkMode={darkMode}
        mapLoaded={mapLoaded}
      />

      {mapLoaded && line1Data && (
        <Source id="line-1" type="geojson" data={line1Data}>
          <Layer id="line-1-casing" type="line" paint={{ 'line-color': '#000000', 'line-width': 7, 'line-opacity': 0.3 }} />
          <Layer id="line-1-stroke" type="line" paint={{ 'line-color': LINE_COLORS['1-line'].color, 'line-width': 4, 'line-opacity': 0.9, 'line-emissive-strength': 1.0 }} />
        </Source>
      )}

      {mapLoaded && line2Data && (
        <Source id="line-2" type="geojson" data={line2Data}>
          <Layer id="line-2-casing" type="line" paint={{ 'line-color': '#000000', 'line-width': 7, 'line-opacity': 0.3 }} />
          <Layer id="line-2-stroke" type="line" paint={{ 'line-color': LINE_COLORS['2-line'].color, 'line-width': 4, 'line-opacity': 0.9, 'line-emissive-strength': 1.0 }} />
        </Source>
      )}

      {mapLoaded && visiblePois && (
        <POILayer
          poiData={visiblePois}
          poiPopup={poiPopup}
          onPoiClick={onPoiClick}
          onPoiClose={onPoiClose}
          onTagClick={onPoiTagClick}
          onStationClick={onPopupStationClick}
          onPopupFocus={onPopupFocus}
          darkMode={darkMode}
          units={units}
        />
      )}

      {mapLoaded && iconsReady && stationsData && (
        <Source id="stations" type="geojson" data={stationsData}>
          <Layer
            id="station-circles"
            type="symbol"
            filter={popup ? ['!=', ['get', 'name'], popup.name] : ['has', 'name']}
            layout={{
              'icon-image': ['concat', 'station-', darkMode ? 'dark' : 'light', '-', ['get', 'lines'], '-', ['to-string', ['get', 'stopCode']]],
              'icon-size': 0.9,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
          />
        </Source>
      )}

      {popup && (
        <StationPill
          key={popup.name}
          longitude={popup.longitude}
          latitude={popup.latitude}
          lines={popup.lines || popup.line.replace('-line', '')}
          stopCode={popup.stopCode}
          name={popup.name}
          junctionHints={junctionHints}
          terminusInfo={terminusInfo}
        />
      )}
    </Map>
  )
})

export default MapView
