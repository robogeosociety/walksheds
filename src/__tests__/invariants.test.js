// Core data invariants checkable from the frontend side.
// IDs are append-only/stable (INV-NNN) — see CLAUDE.md "Core Invariants".
// The data-side invariants live in data/pois/test_invariants.py.
import { describe, it, expect } from 'vitest'
import { MAIN_POI_CATEGORIES, POI_CATEGORIES } from '../constants'
import tagCats from '../../public/pois/tag-categories.json'

const knownTags = new Set(Object.keys(tagCats.tag_to_category))
const knownCats = new Set(Object.keys(POI_CATEGORIES))

// INV-016 — spotlight-references: every spotlight pill's matchCategories /
// matchTags resolves to a real category / tag present in the data, so no pill
// silently matches nothing or references a typo.
describe('INV-016 spotlight-references', () => {
  it('every matchCategory is a real POI category', () => {
    for (const s of MAIN_POI_CATEGORIES) {
      for (const c of s.matchCategories ?? []) {
        expect(knownCats.has(c), `${s.id}: matchCategory "${c}" not in POI_CATEGORIES`).toBe(true)
      }
    }
  })

  it('every matchTag exists in the data', () => {
    for (const s of MAIN_POI_CATEGORIES) {
      for (const t of s.matchTags ?? []) {
        expect(knownTags.has(t), `${s.id}: matchTag "${t}" not in tag_to_category`).toBe(true)
      }
    }
  })
})
