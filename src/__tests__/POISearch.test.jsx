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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POISearch alias-aware matching', () => {
  it('shows the matched alias as the dropdown label, not the canonical', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'dispensary' },
    })
    expect(dropdownTags()).toContain('dispensary')
    expect(dropdownTags()).not.toContain('cannabis')
  })

  it('matches substrings of alias keys and shows the matching alias', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'dispensary' },
    })
    const button = document.querySelector('.poi-search-option')
    fireEvent.mouseDown(button)
    expect(onAddFilter).toHaveBeenCalledWith('cannabis')
  })

  it('selecting a search result calls onCommit so focus can move to the map', () => {
    const onCommit = vi.fn()
    renderSearch({ onCommit })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'pizz' },
    })
    expect(dropdownTags()).toContain('pizza')
  })

  it('does not surface a canonical when neither its name nor any alias matches', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'xyzqq' },
    })
    expect(dropdownTags()).toEqual([])
  })

  it('aliases for a canonical not in availableTags are ignored', () => {
    renderSearch({
      tagAliases: { phantom: 'not-a-real-tag' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'phantom' },
    })
    expect(dropdownTags()).toEqual([])
  })

  it('falls back to plain substring behavior when tagAliases is null', () => {
    renderSearch({ tagAliases: null })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'dispensary' },
    })
    // Without aliases, "dispensary" matches nothing — no chip is named that.
    expect(dropdownTags()).toEqual([])
  })

  it('deduplicates: multiple aliases for the same canonical yield one entry', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
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
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: '' },
    })
    // Dropdown shows up to 8 tags from availableTags minus pinned ones —
    // pizza and child-friendly should be filtered out.
    const labels = dropdownTags()
    expect(labels).not.toContain('pizza')
    expect(labels).not.toContain('child-friendly')
  })
})

describe('POISearch station results (issue #18)', () => {
  const stationFeat = (name, stopCode, lines, line) => ({
    type: 'Feature',
    properties: { name, stopCode, lines, line },
    geometry: { type: 'Point', coordinates: [-122.33, 47.61] },
  })
  const STATIONS = [
    stationFeat('Westlake Station', 50, '1,2', '1-line'),
    stationFeat('Roosevelt Station', 46, '1,2', '1-line'),
    stationFeat('Judkins Park Station', 54, '2', '2-line'),
  ]

  it('shows matching stations above tag results', () => {
    renderSearch({ stations: STATIONS, onStationSelect: vi.fn() })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'roosevelt' },
    })
    const rows = document.querySelectorAll('.poi-search-station')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toMatch(/Roosevelt/)
    // Station rows precede any tag rows in the dropdown.
    const first = document.querySelector('.poi-search-dropdown').firstChild
    expect(first.className).toMatch(/poi-search-station/)
  })

  it('matches stations by number', () => {
    renderSearch({ stations: STATIONS, onStationSelect: vi.fn() })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: '254' },
    })
    const rows = document.querySelectorAll('.poi-search-station')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toMatch(/Judkins Park/)
  })

  it('clicking a station row calls onStationSelect with the feature', () => {
    const onStationSelect = vi.fn()
    const onCommit = vi.fn()
    renderSearch({ stations: STATIONS, onStationSelect, onCommit })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'westlake' },
    })
    fireEvent.mouseDown(document.querySelector('.poi-search-station'))
    expect(onStationSelect).toHaveBeenCalledTimes(1)
    expect(onStationSelect.mock.calls[0][0].properties.name).toBe('Westlake Station')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('Enter selects the highlighted station when it is first in the list', () => {
    const onStationSelect = vi.fn()
    const onAddFilter = vi.fn()
    renderSearch({ stations: STATIONS, onStationSelect, onAddFilter })
    const input = screen.getByPlaceholderText(/Search places/)
    fireEvent.change(input, { target: { value: 'roosevelt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onStationSelect).toHaveBeenCalledTimes(1)
    expect(onAddFilter).not.toHaveBeenCalled()
  })

  it('arrow keys move the highlight from stations into tag rows', () => {
    const onStationSelect = vi.fn()
    const onAddFilter = vi.fn()
    renderSearch({
      stations: [stationFeat('Pioneer Square Station', 52, '1,2', '1-line')],
      onStationSelect,
      onAddFilter,
      availableTags: [{ tag: 'pizza', count: 12, color: '#bbb' }],
    })
    const input = screen.getByPlaceholderText(/Search places/)
    // "pi" matches both Pioneer Square and pizza.
    fireEvent.change(input, { target: { value: 'pi' } })
    expect(document.querySelectorAll('.poi-search-station').length).toBe(1)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAddFilter).toHaveBeenCalledWith('pizza')
    expect(onStationSelect).not.toHaveBeenCalled()
  })

  it('renders no station rows when stations are not provided', () => {
    renderSearch({})
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'westlake' },
    })
    expect(document.querySelectorAll('.poi-search-station').length).toBe(0)
  })
})
