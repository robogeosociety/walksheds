/**
 * Format walking distance + duration for POI popups.
 *
 * Units toggle: 'metric' shows m/km, 'imperial' shows ft/mi.
 * Time is always shown in whole minutes (min 1).
 */

const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344
// Threshold for switching ft → mi (~0.1 mi). Below this we show feet.
const FEET_TO_MILES_AT = 528

export function formatDistance(meters, units) {
  if (meters == null || !isFinite(meters) || meters < 0) return ''
  if (units === 'imperial') {
    const feet = meters / METERS_PER_FOOT
    if (feet < FEET_TO_MILES_AT) {
      // Round to nearest 10 ft for a calm look.
      return `${Math.round(feet / 10) * 10} ft`
    }
    const miles = meters / METERS_PER_MILE
    return `${miles.toFixed(1)} mi`
  }
  // metric (default)
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatMinutes(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return ''
  const m = Math.max(1, Math.round(seconds / 60))
  return `${m} min`
}

export function formatWalk(meters, seconds, units) {
  const d = formatDistance(meters, units)
  const t = formatMinutes(seconds)
  if (d && t) return `${d} · ${t}`
  return d || t
}
