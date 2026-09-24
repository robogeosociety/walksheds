import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
import { CITIES } from '../cities'

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

describe('Walksheds — active city', () => {
  const at = (url) => window.history.replaceState({}, '', url)
  const lineLabels = (container) =>
    [...container.querySelectorAll('.legend-lines .legend-line-label')].map(n => n.textContent)

  afterEach(() => at('/'))

  it('defaults to Seattle: both lines, walkshed toggles present', () => {
    at('/')
    const { container } = render(<Walksheds />)
    expect(lineLabels(container)).toEqual(['1 Line', '2 Line'])
    expect(container.querySelectorAll('.legend-walkshed-item').length).toBe(3)
  })

  it('honors ?city=honolulu: one line, no walkshed toggles', () => {
    at('/?city=honolulu')
    const { container } = render(<Walksheds />)
    // Scoped to the line key: "Skyline" also appears as the city tab's subtitle.
    expect(lineLabels(container)).toEqual(['Skyline'])
    // Honolulu declares no `walksheds` capability, so the section is withheld
    // and replaced by a note rather than showing toggles that do nothing.
    expect(container.querySelectorAll('.legend-walkshed-item').length).toBe(0)
    expect(container.querySelector('.legend-note')).toBeTruthy()
  })

  it('takes the city from a station deep link, over ?city=', () => {
    at('/honolulu/1/8?city=seattle')
    const { container } = render(<Walksheds />)
    expect(lineLabels(container)).toEqual(['Skyline'])
  })

  it('fetches only the active city\'s data root', () => {
    at('/?city=honolulu')
    render(<Walksheds />)
    const urls = globalThis.fetch.mock.calls.map(c => String(c[0]))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every(u => !u.includes('cities/seattle/'))).toBe(true)
    expect(urls.some(u => u.includes('cities/honolulu/all-stations.geojson'))).toBe(true)
    // No POI tile index or stats for a city without the `pois` capability.
    expect(urls.some(u => u.includes('pois/'))).toBe(false)
  })

  it('offers a city tab per registered city', () => {
    at('/')
    const { container } = render(<Walksheds />)
    expect(container.querySelectorAll('.legend-city-tab').length).toBe(CITIES.length)
  })
})
