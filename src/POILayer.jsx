import { useMemo } from 'react'
import { Source, Layer, Popup } from 'react-map-gl'
import { POI_CATEGORIES } from './constants'

const CATEGORY_KEYS = Object.keys(POI_CATEGORIES)

export default function POILayer({ poiData, poiPopup, onPoiClose, onTagClick, darkMode }) {
  const colorMatch = useMemo(() => [
    'match', ['get', 'category'],
    ...CATEGORY_KEYS.flatMap(k => [k, POI_CATEGORIES[k].color]),
    '#999',
  ], [])
  if (!poiData || !poiData.features || poiData.features.length === 0) return null

  return (
    <>
      <Source id="pois" type="geojson" data={poiData}>
        <Layer
          id="poi-circles"
          type="circle"
          paint={{
            'circle-radius': 6,
            'circle-color': colorMatch,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': darkMode ? '#1a1a2a' : '#ffffff',
            'circle-opacity': 0.9,
            'circle-emissive-strength': 1.0,
          }}
        />
        <Layer
          id="poi-labels"
          type="symbol"
          minzoom={15}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-offset': [0, 1.2],
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

      {poiPopup && (
        <Popup
          longitude={poiPopup.longitude}
          latitude={poiPopup.latitude}
          anchor="bottom"
          onClose={onPoiClose}
          closeButton={false}
          closeOnClick={false}
          className="poi-popup-container"
          offset={12}
        >
          <div className="poi-popup">
            <div className="poi-popup-header">
              <div className="poi-popup-name">{poiPopup.name}</div>
              <span className="poi-popup-close" onClick={onPoiClose} role="button" aria-label="Close">
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
            </div>
            {poiPopup.tags && poiPopup.tags.length > 0 && (
              <div className="poi-popup-tags">
                {poiPopup.tags.map(t => {
                  const color = POI_CATEGORIES[t]?.color || POI_CATEGORIES[poiPopup.category]?.color || '#999'
                  return (
                    <button key={t} className="poi-popup-tag" onClick={() => onTagClick?.(t)}>
                      <span className="poi-popup-tag-dot" style={{ background: color }} />
                      <span className="poi-popup-tag-text">{t}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {poiPopup.address && (
              <div className="poi-popup-address">{poiPopup.address}</div>
            )}
            {poiPopup.website && (
              <a
                className="poi-popup-link"
                href={poiPopup.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                Website
              </a>
            )}
          </div>
        </Popup>
      )}
    </>
  )
}
