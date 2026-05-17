import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import POISearch from '../POISearch'

function renderSearch(overrides = {}) {
  const props = {
    availableTags: [
      { tag: 'cannabis', count: 4, color: '#aaa' },
      { tag: 'pizza', count: 12, color: '#bbb' },
      { tag: 'coffee', count: 22, color: '#ccc' },
    ],
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
