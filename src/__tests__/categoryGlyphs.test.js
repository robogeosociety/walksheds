import { describe, it, expect } from 'vitest'
import { categoryGlyph, categoryGlyphForTag } from '../categoryGlyphs'

describe('categoryGlyph', () => {
  it('prefers a per-category override over the group glyph', () => {
    // cafe has its own coffee-cup glyph distinct from the dining group glyph.
    expect(categoryGlyph('dining', 'cafe')).not.toBe(categoryGlyph('dining', 'restaurant'))
  })

  it('falls back to the group glyph, then the default pin', () => {
    expect(categoryGlyph('parks', 'park')).toBe(categoryGlyph('parks', undefined))
    // unknown group + category → the map-pin fallback (a non-empty path).
    expect(typeof categoryGlyph('nope', 'nope')).toBe('string')
    expect(categoryGlyph('nope', 'nope').length).toBeGreaterThan(0)
  })
})

describe('categoryGlyphForTag', () => {
  it('resolves category-named tags to their glyph', () => {
    expect(categoryGlyphForTag('park')).toBe(categoryGlyph('parks', 'park'))
    expect(categoryGlyphForTag('museum')).toBe(categoryGlyph('attractions', 'museum'))
  })

  it('aliases coffee → cafe (the flagship default pill)', () => {
    expect(categoryGlyphForTag('coffee')).toBe(categoryGlyph('dining', 'cafe'))
  })

  it('folds hyphens to underscore category keys', () => {
    expect(categoryGlyphForTag('swimming-pool')).toBe(categoryGlyph('fitness', 'swimming_pool'))
  })

  it('returns null for non-category tags (cuisine / diet / vibe)', () => {
    expect(categoryGlyphForTag('pizza')).toBeNull()
    expect(categoryGlyphForTag('vegan')).toBeNull()
    expect(categoryGlyphForTag('')).toBeNull()
    expect(categoryGlyphForTag(undefined)).toBeNull()
  })
})
