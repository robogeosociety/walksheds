import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const emptyFC = { type: 'FeatureCollection', features: [] }
const TAG_CATEGORIES = {
  categories: {},
  tag_to_category: {},
  filter_tag_categories: [],
  filter_schema: { cat: {}, tag: {}, aliases: {} },
}

// URL-aware fetch: tag-categories.json returns a minimal schema (so POISearch
// mounts); everything else returns an empty FeatureCollection.
beforeEach(() => {
  globalThis.fetch = vi.fn((url) => {
    const body = String(url).includes('tag-categories') ? TAG_CATEGORIES : emptyFC
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

vi.mock('mapbox-gl', () => ({
  default: { Map: vi.fn(), NavigationControl: vi.fn(), supported: () => true },
}))

vi.mock('react-map-gl', () => ({
  default: ({ children }) => <div data-testid="map">{children}</div>,
  Source: ({ children }) => <div>{children}</div>,
  Layer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  GeolocateControl: () => null,
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Walksheds from '../Walksheds'

function setLocation(search = '', pathname = '/') {
  delete window.location
  window.location = {
    pathname,
    search,
    hash: '',
    href: `http://localhost${pathname}${search}`,
    origin: 'http://localhost',
  }
}

describe('embed mode rendering', () => {
  it('strips onboarding + branding chrome but keeps the map, legend and search', async () => {
    setLocation('?embed=1')
    const { container } = render(<Walksheds />)

    expect(screen.getByTestId('map')).toBeTruthy()
    expect(container.querySelector('.app').classList.contains('embed')).toBe(true)
    // Legend present; search mounts once tag categories load.
    expect(container.querySelector('.line-legend')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.poi-search')).toBeTruthy())
    // Onboarding + branding gone.
    expect(container.querySelector('.hint-overlay')).toBeNull()
    expect(container.querySelector('[aria-label="Toggle hints"]')).toBeNull()
    expect(container.querySelector('.legend-wiki-link')).toBeNull()
    // Report + locate hidden via .app modifier classes.
    expect(container.querySelector('.app').classList.contains('embed-hide-report')).toBe(true)
    expect(container.querySelector('.app').classList.contains('embed-hide-locate')).toBe(false)
  })

  it('honors ?legend=0 (JSX gate) and ?search=0', async () => {
    setLocation('?embed=1&legend=0&search=0')
    const { container } = render(<Walksheds />)
    // Legend is always-rendered outside embed, so its absence proves the gate.
    expect(container.querySelector('.line-legend')).toBeNull()
    // Give tag categories a chance to load; search must still be gated out.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.querySelector('.poi-search')).toBeNull()
  })

  it('honors ?locate=0', () => {
    setLocation('?embed=1&locate=0')
    const { container } = render(<Walksheds />)
    expect(container.querySelector('.app').classList.contains('embed-hide-locate')).toBe(true)
  })

  it('applies ?dark=1 without writing localStorage (shared origin)', () => {
    setLocation('?embed=1&dark=1')
    const { container } = render(<Walksheds />)
    expect(container.querySelector('.app').classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('walksheds_dark_mode')).toBeNull()
  })

  it('does not persist a dark toggle keypress in embed mode', () => {
    setLocation('?embed=1')
    render(<Walksheds />)
    fireEvent.keyDown(window, { key: 'd' })
    expect(window.localStorage.getItem('walksheds_dark_mode')).toBeNull()
  })

  it('non-embed control keeps the help button + wiki link and no embed class', () => {
    setLocation('')
    const { container } = render(<Walksheds />)
    expect(container.querySelector('.app').classList.contains('embed')).toBe(false)
    expect(container.querySelector('[aria-label="Toggle hints"]')).toBeTruthy()
    expect(container.querySelector('.legend-wiki-link')).toBeTruthy()
  })
})
