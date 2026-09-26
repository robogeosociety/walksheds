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

  it('honors ?city=honolulu: one line', () => {
    at('/?city=honolulu')
    const { container } = render(<Walksheds />)
    // Scoped to the line key: "Skyline" also appears as the city tab's subtitle.
    expect(lineLabels(container)).toEqual(['Skyline'])
  })

  // Registry-driven rather than pinned to one city's current state: the rule is
  // that the walkshed key appears exactly when the city declares the capability,
  // and a city that lacks it explains the gap instead of showing dead toggles.
  it('shows the walkshed key exactly for cities that declare it', () => {
    for (const c of CITIES) {
      at(`/?city=${c.slug}`)
      const { container, unmount } = render(<Walksheds />)
      const toggles = container.querySelectorAll('.legend-walkshed-item').length
      const note = container.querySelector('.legend-note')
      if (c.capabilities.includes('walksheds')) {
        expect(toggles, `${c.slug} should show toggles`).toBe(3)
        expect(note, `${c.slug} should not show the gap note`).toBeNull()
      } else {
        expect(toggles, `${c.slug} should show no toggles`).toBe(0)
        expect(note, `${c.slug} should explain the gap`).toBeTruthy()
      }
      unmount()
    }
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
  })

  it('requests POI data only for cities that declare it', () => {
    for (const c of CITIES) {
      globalThis.fetch.mockClear()
      at(`/?city=${c.slug}`)
      const { unmount } = render(<Walksheds />)
      const urls = globalThis.fetch.mock.calls.map(u => String(u[0]))
      const askedForPois = urls.some(u => u.includes('/pois/'))
      expect(askedForPois, `${c.slug} pois fetch`).toBe(c.capabilities.includes('pois'))
      unmount()
    }
  })

  it('offers a city tab per registered city', () => {
    at('/')
    const { container } = render(<Walksheds />)
    expect(container.querySelectorAll('.legend-city-tab').length).toBe(CITIES.length)
  })
})
