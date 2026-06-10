import { describe, it, expect, vi, beforeEach } from 'vitest'

const emptyFC = { type: 'FeatureCollection', features: [] }
beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(emptyFC) })
  )
})

vi.mock('mapbox-gl', () => ({
  default: {
    Map: vi.fn(),
    NavigationControl: vi.fn(),
    supported: () => true,
  },
}))

vi.mock('react-map-gl', () => ({
  default: ({ children }) => <div data-testid="map">{children}</div>,
  Source: ({ children }) => <div>{children}</div>,
  Layer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  GeolocateControl: () => null,
}))

import { render, screen } from '@testing-library/react'
import Walksheds from '../Walksheds'

describe('Walksheds', () => {
  it('renders without crashing', () => {
    render(<Walksheds />)
    expect(screen.getByTestId('map')).toBeTruthy()
  })

  it('renders line legend with walkshed toggles', () => {
    const { container } = render(<Walksheds />)
    const legend = container.querySelector('.line-legend')
    expect(legend).toBeTruthy()
    const walkshedItems = container.querySelectorAll('.legend-walkshed-item')
    expect(walkshedItems.length).toBe(3)
  })
})
