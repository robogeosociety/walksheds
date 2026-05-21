import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import LineLegend from '../LineLegend'

function baseProps(overrides = {}) {
  return {
    lineColors: {
      '1-line': { color: '#0078ae', label: 'Line 1' },
      '2-line': { color: '#71c8c9', label: 'Line 2' },
    },
    enabledWalksheds: new Set([5, 10, 15]),
    walkshedAccent: '#0078ae',
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
}

// The dismiss-on-click handler in Walksheds.jsx closes hints on any click
// not inside `[data-hint-keep]`. Without the marker on the ? button, the
// dismiss handler runs in capture phase and flips hintsVisible to false,
// then the button's onClick toggles it right back — visually the hint
// "doesn't close". Asserting the marker keeps that fix in place.
describe('LineLegend hint toggle keeps hints from auto-dismissing', () => {
  it('expanded legend marks the ? button with data-hint-keep', () => {
    const { container } = render(<LineLegend {...baseProps()} />)
    const btn = container.querySelector('button[aria-label="Toggle hints"]')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('data-hint-keep')).toBe('true')
  })

  it('collapsed legend marks the ? button with data-hint-keep', () => {
    const { container } = render(<LineLegend {...baseProps({ collapsed: true })} />)
    const btn = container.querySelector('button[aria-label="Toggle hints"]')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('data-hint-keep')).toBe('true')
  })
})
