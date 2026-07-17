import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LineLegend from '../LineLegend'

const LINE_COLORS = {
  '1-line': { color: '#38B030', label: '1 Line' },
  '2-line': { color: '#00A0E0', label: '2 Line' },
}

function renderLegend(overrides = {}) {
  const props = {
    lineColors: LINE_COLORS,
    enabledWalksheds: new Set([5, 10, 15]),
    walkshedAccent: '#38B030',
    onWalkshedToggle: vi.fn(),
    darkMode: false,
    onDarkModeToggle: vi.fn(),
    units: 'metric',
    onUnitsToggle: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onHintsToggle: vi.fn(),
    position: 'bottom-left',
    ...overrides,
  }
  render(<LineLegend {...props} />)
  return props
}

describe('LineLegend feedback control', () => {
  it('sits inline as an icon button and expands the categories only on click', () => {
    renderLegend()
    const btn = screen.getByRole('button', { name: 'Send feedback' })
    expect(btn).toBeTruthy()
    // Categories are hidden until the icon is clicked (the extra-friction step).
    expect(screen.queryByRole('link', { name: 'Bug', exact: true })).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByRole('link', { name: 'Bug', exact: true })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Idea', exact: true })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Other', exact: true })).toBeTruthy()
  })

  it('links each category to a prefilled GitHub issue via a real anchor', () => {
    // A plain anchor (not window.open) so iOS opens it in the system browser
    // instead of breaking the home-screen PWA / in-app webview.
    renderLegend()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    const anchor = screen.getByRole('link', { name: 'Idea', exact: true })
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toContain('noopener')
    const url = new URL(anchor.getAttribute('href'))
    expect(url.origin + url.pathname).toBe('https://github.com/robogeosociety/walksheds/issues/new')
    expect(url.searchParams.get('labels')).toBe('site-feedback')
    expect(url.searchParams.get('body')).toContain('Reason: idea')
  })

  it('collapses the categories after one is chosen', () => {
    renderLegend()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    fireEvent.click(screen.getByRole('link', { name: 'Idea', exact: true }))
    expect(screen.queryByRole('link', { name: 'Idea', exact: true })).toBeNull()
  })

  it('hides the control entirely when showFeedback is false', () => {
    renderLegend({ showFeedback: false })
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull()
  })

  it('also renders the control in the collapsed legend bar', () => {
    renderLegend({ collapsed: true })
    const btn = screen.getByRole('button', { name: 'Send feedback' })
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(screen.getByRole('link', { name: 'Bug', exact: true })).toBeTruthy()
  })
})

const STATS = {
  pois: 26510,
  stations: 38,
  sources: [
    { id: 'osm', label: 'OpenStreetMap', asOf: '2026-04-24' },
    { id: 'overture', label: 'Overture Places', asOf: '2026-04-15' },
    { id: 'sdot', label: 'SDOT / Sound Transit', asOf: '2026-04-25' },
    { id: 'mapbox', label: 'Mapbox walksheds', live: true },
  ],
}

describe('LineLegend statistics section', () => {
  it('is collapsed by default and expands to counts, sources, and freshness', () => {
    renderLegend({ stats: STATS })
    const toggle = screen.getByRole('button', { name: /Data Statistics/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('26,510')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Points of interest')).toBeTruthy()
    expect(screen.getByText('26,510')).toBeTruthy()
    expect(screen.getByText('Stations')).toBeTruthy()
    expect(screen.getByText('38')).toBeTruthy()
    expect(screen.getByText('OpenStreetMap')).toBeTruthy()
    expect(screen.getByText('Apr 24, 2026')).toBeTruthy()
    expect(screen.getByText('Overture Places')).toBeTruthy()
    expect(screen.getByText('SDOT / Sound Transit')).toBeTruthy()
    expect(screen.getByText('Apr 25, 2026')).toBeTruthy()
    // Walkshed polygons come from the Isochrone API on demand — noted as live.
    expect(screen.getByText('Mapbox walksheds')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('collapses again on a second click', () => {
    renderLegend({ stats: STATS })
    const toggle = screen.getByRole('button', { name: /Data Statistics/ })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByText('26,510')).toBeNull()
  })

  it('is absent while stats have not loaded', () => {
    renderLegend()
    expect(screen.queryByRole('button', { name: /Data Statistics/ })).toBeNull()
  })

  it('is absent from the collapsed legend bar (expanded legend only)', () => {
    renderLegend({ collapsed: true, stats: STATS })
    expect(screen.queryByRole('button', { name: /Data Statistics/ })).toBeNull()
  })
})
