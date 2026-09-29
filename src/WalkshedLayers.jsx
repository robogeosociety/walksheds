import { Source, Layer } from 'react-map-gl'
import { polygonToLine } from './mapbox'
import { WALKSHED_STYLES, WALKSHED_RENDER_ORDER } from './constants'

export default function WalkshedLayers({ walksheds, enabledWalksheds, darkMode, mapLoaded, accent }) {
  if (!mapLoaded) return null

  const styles = darkMode ? WALKSHED_STYLES.dark : WALKSHED_STYLES.light
  const mode = darkMode ? 'dark' : 'light'

  return WALKSHED_RENDER_ORDER.map((min) => {
    const data = walksheds[min]
    if (!data || !enabledWalksheds.has(min)) return null
    const style = styles[min]
    const lineData = polygonToLine(data)
    return (
      <span key={`walkshed-group-${mode}-${min}`}>
        <Source id={`walkshed-${mode}-${min}`} type="geojson" data={data}>
          <Layer
            id={`walkshed-fill-${mode}-${min}`}
            type="fill"
            paint={{ 'fill-color': accent, 'fill-opacity': style.opacity, 'fill-emissive-strength': 1.0 }}
          />
          <Layer
            id={`walkshed-outline-${mode}-${min}`}
            type="line"
            paint={{ 'line-color': accent, 'line-width': style.lineWidth, 'line-opacity': style.outlineOpacity, 'line-emissive-strength': 1.0 }}
          />
        </Source>
        <Source id={`walkshed-label-${mode}-${min}`} type="geojson" data={lineData}>
          <Layer
            id={`walkshed-label-${mode}-${min}`}
            type="symbol"
            layout={{
              'symbol-placement': 'line',
              'text-field': `${min} min`,
              'text-size': 13,
              'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              'symbol-spacing': 150,
              'text-keep-upright': true,
            }}
            paint={{
              'text-color': accent,
              'text-halo-color': darkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
              'text-halo-width': 2,
            }}
          />
        </Source>
      </span>
    )
  })
}
