/**
 * Preview-city filtering, shared by the app and the Vite build.
 *
 * A city marked `preview` in data/cities.py is not ready to be public. The
 * public build drops it from the registry the bundle carries AND prunes its
 * data out of dist/, so a public deploy neither advertises nor serves it; only
 * a build made with VITE_PREVIEW_CITIES=1 includes it.
 *
 * Plain JS with no imports so vite.config.js (node) and the browser bundle can
 * both use it, and so the rule lives in exactly one place.
 */

/** Cities to strip from a build. Empty when preview cities are included. */
export function previewSlugs(registry, includePreview) {
  if (includePreview) return []
  return registry.cities.filter(c => c.preview).map(c => c.slug)
}

/** The registry a build should ship: preview cities removed unless included. */
export function filterRegistry(registry, includePreview) {
  if (includePreview) return registry
  const cities = registry.cities.filter(c => !c.preview)
  // Never leave defaultCity pointing at a city that was just removed.
  const defaultCity = cities.some(c => c.slug === registry.defaultCity)
    ? registry.defaultCity
    : cities[0]?.slug
  return { ...registry, cities, defaultCity }
}

/** Whether a build should include preview cities. */
export function includePreviewCities(env) {
  const raw = env?.VITE_PREVIEW_CITIES
  return raw === '1' || raw === 'true' || raw === true
}
