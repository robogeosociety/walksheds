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
  it('reveals the three feedback reasons only after the trigger is clicked', () => {
    renderLegend()
    expect(screen.queryByText('Bug')).toBeNull()
    fireEvent.click(screen.getByText('Send feedback'))
    expect(screen.getByText('Bug')).toBeTruthy()
    expect(screen.getByText('Idea')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('links each reason to a prefilled GitHub issue via a real anchor', () => {
    // A plain anchor (not window.open) so iOS opens it in the system browser
    // instead of breaking the home-screen PWA / in-app webview.
    renderLegend()
    fireEvent.click(screen.getByText('Send feedback'))
    const anchor = screen.getByText('Idea').closest('a')
    expect(anchor).toBeTruthy()
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toContain('noopener')
    const url = new URL(anchor.getAttribute('href'))
    expect(url.origin + url.pathname).toBe('https://github.com/robogeosociety/walksheds/issues/new')
    expect(url.searchParams.get('labels')).toBe('site-feedback')
    expect(url.searchParams.get('body')).toContain('Reason: idea')
  })

  it('collapses the picker after a reason is chosen', () => {
    renderLegend()
    fireEvent.click(screen.getByText('Send feedback'))
    fireEvent.click(screen.getByText('Idea'))
    expect(screen.queryByText('Idea')).toBeNull()
  })

  it('hides the control when showFeedback is false', () => {
    renderLegend({ showFeedback: false })
    expect(screen.queryByText('Send feedback')).toBeNull()
  })

  it('does not render the control in the collapsed legend', () => {
    renderLegend({ collapsed: true })
    expect(screen.queryByText('Send feedback')).toBeNull()
  })
})
