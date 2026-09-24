import { createContext, useContext } from 'react'
import { cityBySlug, DEFAULT_CITY_SLUG, lineColors } from './cities'

/**
 * The active city, for the leaf components that need line identity (station
 * pills, the legend's line key, junction badges) without every ancestor having
 * to forward it. The provider lives in CityProvider.jsx.
 *
 * Reading outside a provider yields the default city rather than throwing, so a
 * component can be rendered in isolation (unit tests, the POI popup card used
 * standalone) without wiring up context.
 */
export const CityContext = createContext(null)

export function useCityContext() {
  const ctx = useContext(CityContext)
  if (ctx) return ctx
  const city = cityBySlug(DEFAULT_CITY_SLUG)
  return { city, colors: lineColors(city, false) }
}

export function useCity() {
  return useCityContext().city
}

/** `{ '1-line': { color, label, glyph, key } }` for the active city + mode. */
export function useLineColors() {
  return useCityContext().colors
}
