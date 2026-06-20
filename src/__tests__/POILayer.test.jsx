import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock react-map-gl primitives so POILayer can render in jsdom. Marker renders
// its children inside a button that forwards a synthetic click, mirroring how a
// real marker click reaches our onClick handler.
vi.mock('react-map-gl', () => ({
  Source: ({ children }) => <div data-testid="source">{children}</div>,
  Layer: ({ id }) => <div data-testid={`layer-${id}`} />,
  Marker: ({ children, onClick }) => (
    <button
      data-testid="marker"
      onClick={() => onClick?.({ originalEvent: { stopPropagation: () => {} } })}
    >
      {children}
    </button>
  ),
  Popup: ({ children }) => <div data-testid="popup">{children}</div>,
}))

import POILayer from '../POILayer'

const poiData = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: 1, name: 'Oddfellows Cafe', category: 'cafe' }, geometry: { type: 'Point', coordinates: [-122.32, 47.61] } },
    { type: 'Feature', properties: { id: 2, name: 'Cal Anderson Park', category: 'park' }, geometry: { type: 'Point', coordinates: [-122.31, 47.62] } },
  ],
}

describe('POILayer markers', () => {
  it('renders one category-roundel marker per POI with a glyph', () => {
    render(<POILayer poiData={poiData} poiPopup={null} onPoiClick={() => {}} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(2)
    // Each marker carries the shared CategoryIcon roundel (white glyph on color).
    const roundels = document.querySelectorAll('.poi-marker .poi-category-icon')
    expect(roundels).toHaveLength(2)
    expect(document.querySelectorAll('.poi-marker .poi-category-icon svg path')).toHaveLength(2)
  })

  it('keeps the name-label symbol layer (not a circle layer)', () => {
    render(<POILayer poiData={poiData} poiPopup={null} onPoiClick={() => {}} />)
    expect(screen.getByTestId('layer-poi-labels')).toBeTruthy()
    expect(screen.queryByTestId('layer-poi-circles')).toBeNull()
  })

  it('clicking a marker fires onPoiClick with that POI feature', () => {
    const onPoiClick = vi.fn()
    render(<POILayer poiData={poiData} poiPopup={null} onPoiClick={onPoiClick} />)
    fireEvent.click(screen.getAllByTestId('marker')[0])
    expect(onPoiClick).toHaveBeenCalledTimes(1)
    expect(onPoiClick.mock.calls[0][0].properties.name).toBe('Oddfellows Cafe')
  })

  it('renders nothing when there are no POIs', () => {
    const { container } = render(<POILayer poiData={{ type: 'FeatureCollection', features: [] }} poiPopup={null} onPoiClick={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})
