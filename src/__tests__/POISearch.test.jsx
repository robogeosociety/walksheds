import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import POISearch from '../POISearch'

function renderSearch(overrides = {}) {
  const props = {
    availableTags: [
      { tag: 'cannabis', count: 4, color: '#aaa' },
      { tag: 'pizza', count: 12, color: '#bbb' },
      { tag: 'coffee', count: 22, color: '#ccc' },
      { tag: 'child-friendly', count: 7, color: '#ddd' },
    ],
    globalAvailableTags: [],
    activeCategories: new Set(),
    activeFilters: new Set(),
    poiFeatures: [],
    expandedTag: null,
    onExpandTag: vi.fn(),
    onAddFilter: vi.fn(),
    onRemoveFilter: vi.fn(),
    onClearFilters: vi.fn(),
    onPoiSelect: vi.fn(),
    mainCategories: [],
    enabledCategories: new Set(),
    onToggleCategory: vi.fn(),
    tagAliases: null,
    ...overrides,
  }
  return render(<POISearch {...props} />)
}

function dropdownTags() {
  const labels = document.querySelectorAll('.poi-search-option .poi-search-option-tag')
  return Array.from(labels).map(el => el.textContent)
}

function dropdownStations() {
  const rows = document.querySelectorAll('.poi-search-option-station .pill-name')
  return Array.from(rows).map(el => el.textContent)
}

// Minimal subset of stations for matcher tests — covers a shared 50 (Westlake),
// a stop-code-54 collision (Stadium on Line 1, Judkins Park on Line 2), a
// few line-exclusive entries, and an aliasable name (Capitol Hill).
const TEST_STATIONS = [
  { name: 'Westlake Station',                stopCode: 50, lines: '1,2', lng: -122.336, lat: 47.611, line: '1-line' },
  { name: 'Capitol Hill Station',            stopCode: 49, lines: '1,2', lng: -122.320, lat: 47.619, line: '1-line' },
  { name: 'U District Station',              stopCode: 47, lines: '1,2', lng: -122.313, lat: 47.660, line: '1-line' },
  { name: 'UW Station',                      stopCode: 48, lines: '1,2', lng: -122.304, lat: 47.649, line: '1-line' },
  { name: 'Intl District/Chinatown Station', stopCode: 53, lines: '1,2', lng: -122.328, lat: 47.598, line: '1-line' },
  { name: 'SeaTac/Airport Station',          stopCode: 64, lines: '1',   lng: -122.297, lat: 47.444, line: '1-line' },
  { name: 'Stadium Station',                 stopCode: 54, lines: '1',   lng: -122.327, lat: 47.591, line: '1-line' },
  { name: 'Judkins Park Station',            stopCode: 54, lines: '2',   lng: -122.298, lat: 47.591, line: '2-line' },
  { name: 'Beacon Hill Station',             stopCode: 56, lines: '1',   lng: -122.311, lat: 47.579, line: '1-line' },
  { name: 'South Bellevue Station',          stopCode: 56, lines: '2',   lng: -122.193, lat: 47.586, line: '2-line' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POISearch alias-aware matching', () => {
  it('shows the matched alias as the dropdown label, not the canonical', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'dispensary' },
    })
    expect(dropdownTags()).toContain('dispensary')
    expect(dropdownTags()).not.toContain('cannabis')
  })

  it('matches substrings of alias keys and shows the matching alias', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'disp' },
    })
    // First alias matching the substring is shown; the canonical name is not.
    expect(dropdownTags()).toContain('dispensary')
    expect(dropdownTags()).not.toContain('cannabis')
  })

  it('selecting an alias result adds the canonical tag as a filter', () => {
    const onAddFilter = vi.fn()
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
      onAddFilter,
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'dispensary' },
    })
    const button = document.querySelector('.poi-search-option')
    fireEvent.mouseDown(button)
    expect(onAddFilter).toHaveBeenCalledWith('cannabis')
  })

  it('selecting a search result calls onCommit so focus can move to the map', () => {
    const onCommit = vi.fn()
    renderSearch({ onCommit })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'pizz' },
    })
    fireEvent.mouseDown(document.querySelector('.poi-search-option'))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('toggling a category pill calls onCommit so focus can move to the map', () => {
    const onCommit = vi.fn()
    const onToggleCategory = vi.fn()
    renderSearch({
      onCommit,
      onToggleCategory,
      mainCategories: [{ id: 'restaurants', label: 'Restaurants', color: '#E67E22' }],
      enabledCategories: new Set(),
    })
    fireEvent.click(screen.getByText('Restaurants'))
    expect(onToggleCategory).toHaveBeenCalledWith('restaurants')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('prefers the canonical name when both the tag and an alias would match', () => {
    // Contrived: an alias whose key also contains "ann" (matches "cannabis").
    renderSearch({
      tagAliases: { 'canna-shop': 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'canna' },
    })
    // Tag itself matched, so it wins; the alias is not surfaced.
    expect(dropdownTags()).toContain('cannabis')
    expect(dropdownTags()).not.toContain('canna-shop')
  })

  it('still matches direct substrings of the tag itself', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'pizz' },
    })
    expect(dropdownTags()).toContain('pizza')
  })

  it('does not surface a canonical when neither its name nor any alias matches', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'xyzqq' },
    })
    expect(dropdownTags()).toEqual([])
  })

  it('aliases for a canonical not in availableTags are ignored', () => {
    renderSearch({
      tagAliases: { phantom: 'not-a-real-tag' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'phantom' },
    })
    expect(dropdownTags()).toEqual([])
  })

  it('falls back to plain substring behavior when tagAliases is null', () => {
    renderSearch({ tagAliases: null })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'dispensary' },
    })
    // Without aliases, "dispensary" matches nothing — no chip is named that.
    expect(dropdownTags()).toEqual([])
  })

  it('deduplicates: multiple aliases for the same canonical yield one entry', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'disp' },
    })
    // One row per canonical, regardless of how many of its aliases match.
    expect(dropdownTags().length).toBe(1)
  })
})

describe('POISearch category pills vs filter checkboxes', () => {
  it('renders an active category as a pill (not a checkbox row)', () => {
    renderSearch({
      activeCategories: new Set(['pizza']),
      activeFilters: new Set(),
    })
    expect(document.querySelector('.poi-cat-pill-tag')).toBeTruthy()
    expect(document.querySelector('.poi-filter-row')).toBeNull()
  })

  it('renders an active filter as a checkbox row (not a pill)', () => {
    renderSearch({
      activeCategories: new Set(),
      activeFilters: new Set(['child-friendly']),
    })
    const row = document.querySelector('.poi-filter-row')
    expect(row).toBeTruthy()
    expect(row.textContent).toMatch(/child-friendly/)
    expect(document.querySelector('.poi-cat-pill-tag')).toBeNull()
  })

  it('checkbox is initially checked and clicking it calls onRemoveFilter with the tag', () => {
    const onRemoveFilter = vi.fn()
    renderSearch({
      activeFilters: new Set(['child-friendly']),
      onRemoveFilter,
    })
    const checkbox = document.querySelector('.poi-filter-checkbox')
    expect(checkbox).toBeTruthy()
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(onRemoveFilter).toHaveBeenCalledWith('child-friendly')
  })

  it('renders both a pill row and a filter row when both are active', () => {
    renderSearch({
      activeCategories: new Set(['pizza']),
      activeFilters: new Set(['child-friendly']),
    })
    expect(document.querySelector('.poi-cat-pill-tag')).toBeTruthy()
    expect(document.querySelector('.poi-filter-row')).toBeTruthy()
  })

  it('pads dropdown with out-of-walkshed matches when in-walkshed has no hit', () => {
    renderSearch({
      availableTags: [{ tag: 'pizza', count: 12, color: '#bbb' }],
      globalAvailableTags: [
        { tag: 'pizza', count: 200, color: '#bbb' },
        { tag: 'gyros', count: 8, color: '#aaa' },
      ],
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'gyro' },
    })
    const labels = dropdownTags()
    expect(labels).toContain('gyros')
    const row = document.querySelector('.poi-search-option.out-of-walkshed')
    expect(row).toBeTruthy()
    expect(row.textContent).toMatch(/not in walkshed/)
    // The count badge is suppressed for greyed rows.
    expect(row.querySelector('.poi-search-option-count')).toBeNull()
  })

  it('global fallback does not duplicate a tag already in the walkshed', () => {
    renderSearch({
      availableTags: [{ tag: 'pizza', count: 12, color: '#bbb' }],
      globalAvailableTags: [{ tag: 'pizza', count: 200, color: '#bbb' }],
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: 'pizz' },
    })
    expect(dropdownTags().filter(t => t === 'pizza')).toHaveLength(1)
    expect(document.querySelector('.poi-search-option.out-of-walkshed')).toBeNull()
  })

  it('search dropdown hides tags already pinned in either bucket', () => {
    renderSearch({
      activeCategories: new Set(['pizza']),
      activeFilters: new Set(['child-friendly']),
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations or places/), {
      target: { value: '' },
    })
    // Dropdown shows up to 8 tags from availableTags minus pinned ones —
    // pizza and child-friendly should be filtered out.
    const labels = dropdownTags()
    expect(labels).not.toContain('pizza')
    expect(labels).not.toContain('child-friendly')
  })

  it('placeholder advertises both stations and places', () => {
    renderSearch()
    expect(screen.getByPlaceholderText(/Search stations or places/)).toBeTruthy()
  })
})

describe('POISearch station results', () => {
  it('matches a station by case-insensitive name substring', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: 'u district' },
    })
    expect(dropdownStations()).toContain('U District')
  })

  it('matches a station by 2-digit stop code', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '50' },
    })
    expect(dropdownStations()).toEqual(['Westlake'])
  })

  it('a stop code shared across lines returns both stations', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '54' },
    })
    const rows = dropdownStations()
    expect(rows).toContain('Stadium')
    expect(rows).toContain('Judkins Park')
  })

  it('disambiguates by line prefix (1-56 → Beacon Hill, 2-56 → South Bellevue)', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '1-56' },
    })
    expect(dropdownStations()).toEqual(['Beacon Hill'])

    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '2-56' },
    })
    expect(dropdownStations()).toEqual(['South Bellevue'])
  })

  it('resolves "cap hill" via the station alias map', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: 'cap hill' },
    })
    expect(dropdownStations()).toContain('Capitol Hill')
  })

  it('resolves "chinatown" → Intl District/Chinatown', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: 'chinatown' },
    })
    expect(dropdownStations()).toContain('Intl District/Chinatown')
  })

  it('resolves "seatac" → SeaTac/Airport', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: 'seatac' },
    })
    expect(dropdownStations()).toContain('SeaTac/Airport')
  })

  it('clicking a station row calls onStationSelect with the station', () => {
    const onStationSelect = vi.fn()
    renderSearch({ stations: TEST_STATIONS, onStationSelect })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '50' },
    })
    const row = document.querySelector('.poi-search-option-station')
    fireEvent.mouseDown(row)
    expect(onStationSelect).toHaveBeenCalledTimes(1)
    expect(onStationSelect.mock.calls[0][0].name).toBe('Westlake Station')
    expect(onStationSelect.mock.calls[0][0].stopCode).toBe(50)
  })

  it('Enter on the first dropdown row selects the highlighted station', () => {
    const onStationSelect = vi.fn()
    renderSearch({ stations: TEST_STATIONS, onStationSelect })
    const input = screen.getByPlaceholderText(/Search stations/)
    fireEvent.change(input, { target: { value: 'capitol' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onStationSelect).toHaveBeenCalledTimes(1)
    expect(onStationSelect.mock.calls[0][0].name).toBe('Capitol Hill Station')
  })

  it('stations render above POI tag rows in the dropdown', () => {
    renderSearch({
      stations: TEST_STATIONS,
      availableTags: [
        // "stadium" isn't a real POI tag but it's a clean way to force a row.
        { tag: 'stadium', count: 3, color: '#bbb' },
      ],
    })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: 'stadium' },
    })
    const allRows = document.querySelectorAll('.poi-search-dropdown > *')
    expect(allRows[0].classList.contains('poi-search-option-station')).toBe(true)
    expect(allRows[allRows.length - 1].classList.contains('poi-search-option-station')).toBe(false)
  })

  it('does not surface stations when the query is empty', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.focus(screen.getByPlaceholderText(/Search stations/))
    expect(dropdownStations()).toEqual([])
  })

  it('renders the StationPillBody (line circles + stop code + name)', () => {
    renderSearch({ stations: TEST_STATIONS })
    fireEvent.change(screen.getByPlaceholderText(/Search stations/), {
      target: { value: '50' },
    })
    const row = document.querySelector('.poi-search-option-station')
    expect(row.querySelector('.station-pill')).toBeTruthy()
    expect(row.querySelector('.pill-circle')).toBeTruthy()
    expect(row.querySelector('.pill-code').textContent).toBe('50')
    expect(row.querySelector('.pill-name').textContent).toBe('Westlake')
  })
})

