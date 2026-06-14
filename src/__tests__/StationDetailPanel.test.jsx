import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StationDetailPanel from '../StationDetailPanel'

const STATION = { name: 'Westlake Station', lines: '1,2', stopCode: 50 }

const EXITS = [
  { id: 1, stationKey: '1,2-50', name: 'Pine St', bearing: 10, accessible: true, coordinates: [-122.3370, 47.6120] },
  { id: 2, stationKey: '1,2-50', name: 'Olive Way', bearing: 200, accessible: false, coordinates: [-122.3360, 47.6110] },
]

function renderPanel(overrides = {}) {
  const props = {
    station: STATION,
    exits: EXITS,
    contextPoi: null,
    onClose: vi.fn(),
    onExitClick: vi.fn(),
    onPopupFocus: vi.fn(),
    units: 'metric',
    ...overrides,
  }
  render(<StationDetailPanel {...props} />)
  return props
}

describe('StationDetailPanel header & meta', () => {
  it('renders the station pill and the lines served', () => {
    renderPanel()
    expect(screen.getByText('Westlake')).toBeTruthy()
    expect(screen.getByText('1 Line')).toBeTruthy()
    expect(screen.getByText('2 Line')).toBeTruthy()
  })

  it('summarizes step-free exits', () => {
    renderPanel()
    expect(screen.getByText('1 step-free')).toBeTruthy()
  })
})

describe('StationDetailPanel exits list', () => {
  it('lists every exit', () => {
    renderPanel()
    expect(screen.getByText('Pine St')).toBeTruthy()
    expect(screen.getByText('Olive Way')).toBeTruthy()
  })

  it('forwards exit clicks', () => {
    const { onExitClick } = renderPanel()
    fireEvent.click(screen.getByText('Pine St'))
    expect(onExitClick).toHaveBeenCalledWith(EXITS[0])
  })

  it('shows the empty state when a station has no mapped exits', () => {
    renderPanel({ exits: [] })
    expect(screen.getByText('Exits not yet mapped')).toBeTruthy()
  })
})

describe('StationDetailPanel best-exit highlight', () => {
  const CONTEXT_POI = { name: 'Some Cafe', longitude: -122.3361, latitude: 47.6111 }

  it('badges and prioritizes the exit nearest the POI in context', () => {
    renderPanel({ contextPoi: CONTEXT_POI })
    // Olive Way (id 2) sits right by the POI → it is the best exit.
    const rows = document.querySelectorAll('.station-detail-exit-row')
    expect(rows[0].textContent).toContain('Olive Way')
    expect(rows[0].classList.contains('best')).toBe(true)
    expect(screen.getByText(/Best/)).toBeTruthy()
    expect(screen.getByText('Closest exit to Some Cafe')).toBeTruthy()
  })

  it('shows no best badge without a POI in context', () => {
    renderPanel()
    expect(document.querySelector('.station-detail-exit-row.best')).toBeNull()
    expect(screen.queryByText(/Closest exit/)).toBeNull()
  })
})
