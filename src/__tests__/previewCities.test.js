import { describe, it, expect } from 'vitest'
import { filterRegistry, includePreviewCities, previewSlugs } from '../previewCities'
import REGISTRY from '../cityRegistry.json'

const sample = {
  defaultCity: 'seattle',
  cities: [
    { slug: 'seattle', preview: false },
    { slug: 'honolulu', preview: true },
  ],
}

describe('includePreviewCities', () => {
  it('opts in only on an explicit truthy flag', () => {
    expect(includePreviewCities({ VITE_PREVIEW_CITIES: '1' })).toBe(true)
    expect(includePreviewCities({ VITE_PREVIEW_CITIES: 'true' })).toBe(true)
    expect(includePreviewCities({ VITE_PREVIEW_CITIES: '0' })).toBe(false)
    expect(includePreviewCities({ VITE_PREVIEW_CITIES: '' })).toBe(false)
    expect(includePreviewCities({})).toBe(false)
    expect(includePreviewCities(undefined)).toBe(false)
  })
})

describe('previewSlugs', () => {
  it('names the cities a public build must prune', () => {
    expect(previewSlugs(sample, false)).toEqual(['honolulu'])
  })

  it('prunes nothing when preview cities are included', () => {
    expect(previewSlugs(sample, true)).toEqual([])
  })
})

describe('filterRegistry', () => {
  it('drops preview cities from a public build', () => {
    const out = filterRegistry(sample, false)
    expect(out.cities.map(c => c.slug)).toEqual(['seattle'])
  })

  it('passes the registry through untouched when including preview', () => {
    expect(filterRegistry(sample, true)).toBe(sample)
  })

  it('never leaves defaultCity pointing at a removed city', () => {
    const out = filterRegistry(
      { defaultCity: 'honolulu', cities: sample.cities }, false,
    )
    expect(out.defaultCity).toBe('seattle')
    expect(out.cities.map(c => c.slug)).toEqual(['seattle'])
  })

  it('leaves a valid defaultCity alone', () => {
    expect(filterRegistry(sample, false).defaultCity).toBe('seattle')
  })
})

describe('the committed registry', () => {
  it('every city declares preview explicitly', () => {
    for (const c of REGISTRY.cities) {
      expect(typeof c.preview, `${c.slug}.preview`).toBe('boolean')
    }
  })

  it('the public build keeps a usable default city', () => {
    const out = filterRegistry(REGISTRY, false)
    expect(out.cities.length).toBeGreaterThan(0)
    expect(out.cities.some(c => c.slug === out.defaultCity)).toBe(true)
  })
})
