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
