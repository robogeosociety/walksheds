import { Source, Layer, Popup, Marker } from 'react-map-gl'
import POIPopupCard from './POIPopupCard'
import CategoryIcon from './poiIcons'

export default function POILayer({ poiData, poiPopup, onPoiClick, onPoiClose, onTagClick, onStationClick, onPopupFocus, darkMode, units, exitIndex }) {
  if (!poiData || !poiData.features || poiData.features.length === 0) return null

  return (
    <>
      {/* Name labels stay a Mapbox symbol layer (collision-managed, zoom-gated).
          The marker itself is now an HTML CategoryIcon roundel — the same icon
          the popup header renders — so a place reads identically on the map and
          in its popup (issue: POI marker migration). */}
      <Source id="pois" type="geojson" data={poiData}>
        <Layer
          id="poi-labels"
          type="symbol"
          minzoom={15}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-offset': [0, 1.7],
            'text-anchor': 'top',
            'text-max-width': 8,
            'text-optional': true,
          }}
          paint={{
            'text-color': darkMode ? 'rgba(255,255,255,0.8)' : '#333',
            'text-halo-color': darkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
            'text-halo-width': 1.5,
          }}
        />
      </Source>

      {poiData.features.map((f) => (
        <Marker
          key={f.properties.id ?? `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`}
          longitude={f.geometry.coordinates[0]}
          latitude={f.geometry.coordinates[1]}
          anchor="center"
          onClick={(e) => {
            // Stop the click from also reaching the map handler (which would
            // dismiss the popup we're about to open). MapView additionally sets
            // a suppress flag via the wrapped onPoiClick.
            e.originalEvent?.stopPropagation()
            onPoiClick(f)
          }}
        >
          <div className="poi-marker" title={f.properties.name}>
            <CategoryIcon category={f.properties.category} size={22} />
          </div>
        </Marker>
      ))}

      {poiPopup && (
        <Popup
          longitude={poiPopup.longitude}
          latitude={poiPopup.latitude}
          anchor="bottom"
          onClose={onPoiClose}
          closeButton={false}
          closeOnClick={false}
          className="poi-popup-container"
          offset={20}
        >
          <POIPopupCard
            key={poiPopup.id ?? poiPopup.name}
            poi={poiPopup}
            onClose={onPoiClose}
            onTagClick={onTagClick}
            onStationClick={onStationClick}
            onPopupFocus={onPopupFocus}
            units={units}
            exitIndex={exitIndex}
          />
        </Popup>
      )}
    </>
  )
}
