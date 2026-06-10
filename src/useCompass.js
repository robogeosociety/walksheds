import { useRef, useCallback, useEffect } from 'react'

// Live compass rotation for the locate control (issue #16): while the
// user-location tracking is active, device orientation rotates the map
// to match where the user is facing; when tracking stops, the map eases
// back to north-up.

// Minimum heading change before we touch the map — raw compass output
// jitters by a degree or two even when the device is still.
const MIN_DELTA_DEG = 2

/**
 * Compass heading (degrees clockwise from true north) from a device
 * orientation event, or null when the event carries no usable heading.
 * iOS exposes `webkitCompassHeading` directly; the standard API gives
 * `alpha` (counterclockwise from north when `absolute`), which inverts
 * to a compass heading.
 */
export function computeCompassBearing(event) {
  if (typeof event?.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading
  }
  if (event?.absolute && typeof event.alpha === 'number') {
    return (360 - event.alpha) % 360
  }
  return null
}

/**
 * Returns { start, stop } to bind to the geolocate control's
 * track-user-location lifecycle. `getMap` defers the map lookup so the
 * hook never holds a stale instance. start() asks iOS for orientation
 * permission when required (it runs inside the control's click gesture,
 * which is what the permission prompt needs) and degrades silently
 * everywhere the API or permission is unavailable.
 */
export function useCompassRotation(getMap) {
  const handlerRef = useRef(null)
  const lastBearingRef = useRef(null)

  const stop = useCallback(() => {
    if (handlerRef.current) {
      window.removeEventListener('deviceorientationabsolute', handlerRef.current)
      window.removeEventListener('deviceorientation', handlerRef.current)
      handlerRef.current = null
    }
    lastBearingRef.current = null
    getMap()?.easeTo({ bearing: 0, duration: 400 })
  }, [getMap])

  const start = useCallback(async () => {
    if (handlerRef.current || typeof window.DeviceOrientationEvent === 'undefined') return
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const result = await window.DeviceOrientationEvent.requestPermission()
        if (result !== 'granted') return
      }
    } catch {
      return
    }
    const handler = (event) => {
      const bearing = computeCompassBearing(event)
      if (bearing == null) return
      const last = lastBearingRef.current
      if (last != null && Math.abs(bearing - last) < MIN_DELTA_DEG) return
      lastBearingRef.current = bearing
      getMap()?.setBearing(bearing)
    }
    handlerRef.current = handler
    // Prefer the absolute event (Chrome/Android); fall back to the plain
    // event, whose handler ignores non-absolute readings unless iOS's
    // webkitCompassHeading is present.
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handler)
    } else {
      window.addEventListener('deviceorientation', handler)
    }
  }, [getMap])

  useEffect(() => stop, [stop])

  return { start, stop }
}
