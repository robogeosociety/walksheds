import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import POIPopupCard from '../POIPopupCard'

const FULL_POI = {
  id: 42,
  name: 'Dick\'s Drive-In',
  category: 'fast_food',
  tags: ['fast-food', 'burger', 'takeaway', 'drive-through', 'wifi', 'fries'],
  address: '115 Broadway E',
  hours: 'Mo-Su 10:30-02:00',
  phone: '+12063235800',
  website: 'https://www.ddir.com/locations/capitol-hill',
  stations: [
    { stopCode: 49, lines: '1,2', name: 'Capitol Hill Station', walkingMeters: 350, walkingSeconds: 280, band: 5 },
  ],
}

function renderCard(poi = FULL_POI, overrides = {}) {
  const props = {
    poi,
    onClose: vi.fn(),
    onTagClick: vi.fn(),
    onStationClick: vi.fn(),
    onPopupFocus: vi.fn(),
    units: 'metric',
    ...overrides,
  }
  render(<POIPopupCard {...props} />)
  return props
}

describe('POIPopupCard header', () => {
  it('renders the category roundel icon and label', () => {
    renderCard()
    expect(screen.getByRole('img', { name: 'Fast Food' })).toBeTruthy()
    expect(screen.getByText('Fast Food')).toBeTruthy()
    expect(screen.getByText("Dick's Drive-In")).toBeTruthy()
  })

  it('falls back gracefully for an unknown category', () => {
    renderCard({ ...FULL_POI, category: 'mystery' })
    expect(screen.getByRole('img', { name: 'mystery' })).toBeTruthy()
    expect(document.querySelector('.poi-popup-category')).toBeNull()
  })
})

describe('POIPopupCard expandable info rows', () => {
  it('shows the first two info fields and tucks the rest behind a toggle', () => {
    renderCard()
    expect(screen.getByText('115 Broadway E')).toBeTruthy()
    expect(screen.getByText('Mo-Su 10:30-02:00')).toBeTruthy()
    expect(screen.queryByText('+12063235800')).toBeNull()
    expect(screen.queryByText('ddir.com')).toBeNull()

    fireEvent.click(screen.getByText('2 more'))
    expect(screen.getByText('+12063235800')).toBeTruthy()
    expect(screen.getByText('ddir.com')).toBeTruthy()

    fireEvent.click(screen.getByText('less'))
    expect(screen.queryByText('+12063235800')).toBeNull()
  })

  it('renders no toggle when two or fewer fields exist', () => {
    renderCard({ ...FULL_POI, phone: undefined, website: undefined })
    expect(screen.getByText('115 Broadway E')).toBeTruthy()
    expect(screen.queryByText(/more$/)).toBeNull()
  })

  it('renders phone as a tel: link and website by hostname', () => {
    renderCard()
    fireEvent.click(screen.getByText('2 more'))
    expect(screen.getByText('+12063235800').getAttribute('href')).toBe('tel:+12063235800')
    const site = screen.getByText('ddir.com')
    expect(site.getAttribute('href')).toBe('https://www.ddir.com/locations/capitol-hill')
    expect(site.getAttribute('target')).toBe('_blank')
  })

  it('omits the info section entirely when no fields exist', () => {
    renderCard({ name: 'Mystery Spot', category: 'park', tags: [] })
    expect(document.querySelector('.poi-popup-info')).toBeNull()
  })
})

describe('POIPopupCard tag capping', () => {
  it('caps tags at four with an expander showing the hidden count', () => {
    renderCard()
    expect(document.querySelectorAll('.poi-popup-tag').length).toBe(4)
    fireEvent.click(screen.getByText('2 more tags'))
    expect(document.querySelectorAll('.poi-popup-tag').length).toBe(6)
    fireEvent.click(screen.getByText('fewer tags'))
    expect(document.querySelectorAll('.poi-popup-tag').length).toBe(4)
  })

  it('shows no tag expander for four or fewer tags', () => {
    renderCard({ ...FULL_POI, tags: ['burger', 'wifi'] })
    expect(document.querySelectorAll('.poi-popup-tag').length).toBe(2)
    expect(screen.queryByText(/more tags/)).toBeNull()
  })

  it('clicking a tag calls onTagClick', () => {
    const { onTagClick } = renderCard()
    fireEvent.click(screen.getByText('burger'))
    expect(onTagClick).toHaveBeenCalledWith('burger')
  })
})

describe('POIPopupCard stations section', () => {
  it('renders nearest-station rows and forwards clicks', () => {
    const { onStationClick } = renderCard()
    expect(screen.getByText('Stations within a 15 min walk')).toBeTruthy()
    fireEvent.click(document.querySelector('.poi-popup-station-row'))
    expect(onStationClick).toHaveBeenCalledWith(FULL_POI.stations[0])
  })

  it('renders the best-exit badge inline with the roundel when exits are known', () => {
    const poi = { ...FULL_POI, longitude: -122.32, latitude: 47.619 }
    const exitIndex = new Map([
      ['1,2-49', [
        { id: 1, name: 'Exit B', bearing: 90, coordinates: [-122.319, 47.6191] },
        { id: 2, name: 'Denny', bearing: 270, coordinates: [-122.325, 47.6189] },
      ]],
    ])
    renderCard(poi, { exitIndex })
    const badge = document.querySelector('.poi-popup-exit-badge')
    expect(badge).toBeTruthy()
    // Closest exit to the POI is "Exit B" → code "B".
    expect(badge.textContent).toBe('EXITB')
  })

  it('omits the exit badge when no exit data is supplied', () => {
    renderCard()
    expect(document.querySelector('.poi-popup-exit-badge')).toBeNull()
  })
})

describe('POIPopupCard report control', () => {
  it('reveals the three flag reasons only after the trigger is clicked', () => {
    renderCard()
    expect(screen.queryByText('Closed')).toBeNull()
    fireEvent.click(screen.getByText('Report a problem'))
    expect(screen.getByText('Closed')).toBeTruthy()
    expect(screen.getByText('Duplicate')).toBeTruthy()
    expect(screen.getByText('Inaccurate')).toBeTruthy()
  })

  it('links each reason to a prefilled GitHub issue via a real anchor', () => {
    // A plain anchor (not window.open) so iOS opens it in the system browser
    // instead of breaking the home-screen PWA / in-app webview.
    renderCard()
    fireEvent.click(screen.getByText('Report a problem'))
    const anchor = screen.getByText('Duplicate').closest('a')
    expect(anchor).toBeTruthy()
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toContain('noopener')
    const url = new URL(anchor.getAttribute('href'))
    expect(url.origin + url.pathname).toBe('https://github.com/robogeosociety/walksheds/issues/new')
    expect(url.searchParams.get('labels')).toBe('poi-feedback')
    const body = url.searchParams.get('body')
    expect(body).toContain('Reason: duplicate')
    expect(body).toContain('POI ID: 42')
  })

  it('collapses the picker after a reason is chosen', () => {
    renderCard()
    fireEvent.click(screen.getByText('Report a problem'))
    fireEvent.click(screen.getByText('Duplicate'))
    expect(screen.queryByText('Duplicate')).toBeNull()
  })
})
