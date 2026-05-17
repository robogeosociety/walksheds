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
  it('surfaces a canonical chip when the query matches an alias key', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'dispensary' },
    })
    expect(dropdownTags()).toContain('cannabis')
  })

  it('matches substrings of alias keys, not just exact', () => {
    renderSearch({
      tagAliases: { dispensary: 'cannabis', dispensaries: 'cannabis' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Search places/), {
      target: { value: 'disp' },
    })
    expect(dropdownTags()).toContain('cannabis')
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
    const cannabisCount = dropdownTags().filter(t => t === 'cannabis').length
    expect(cannabisCount).toBe(1)
  })
})
