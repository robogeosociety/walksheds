import { useRef, useCallback, useEffect } from 'react'

// Live compass rotation for the locate control (issue #16): while the
// user is in an orientation session, device orientation rotates the map
// to match where they are facing; ending the session eases the map back
// to north-up.
//
// The session is NOT tied to Mapbox's trackuserlocationend event alone:
// that fires on any non-geolocate camera move while position-locked —
// including our own station-snap fitBounds and every setBearing tick
// this hook makes — demoting the control to its background state. The
// host (Walksheds) decides when the session ends: navigating to another
// station, or the user switching the control fully off.

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
 * Returns { start, stop } for the host to bind to the orientation
 * session. `getMap` defers the map lookup so the hook never holds a
 * stale instance.
 *
 * start() asks iOS for orientation permission when required (it runs
 * inside the locate button's click gesture, which is what the prompt
 * needs) and degrades silently where the API or permission is
 * unavailable. Because that await can take seconds (the user reading
 * the prompt), a stop() that lands in the meantime must win: each
 * start bumps a generation token and re-checks it after the await, so
 * a cancelled start never attaches an orphaned listener — the bug that
 * made rotation impossible to disable.
 */
export function useCompassRotation(getMap) {
  const handlerRef = useRef(null)
  const lastBearingRef = useRef(null)
  const generationRef = useRef(0)

  const stop = useCallback(() => {
    generationRef.current++
    const wasRunning = !!handlerRef.current
    if (handlerRef.current) {
      window.removeEventListener('deviceorientationabsolute', handlerRef.current)
      window.removeEventListener('deviceorientation', handlerRef.current)
      handlerRef.current = null
    }
    lastBearingRef.current = null
    // Only re-north the map when rotation was actually active — stop()
    // is also called defensively (every station navigation), and a
    // gratuitous easeTo would fight the selection's own camera moves.
    if (wasRunning) getMap()?.easeTo({ bearing: 0, duration: 400 })
  }, [getMap])

  const start = useCallback(async () => {
    if (handlerRef.current || typeof window.DeviceOrientationEvent === 'undefined') return
    const generation = ++generationRef.current
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const result = await window.DeviceOrientationEvent.requestPermission()
        if (result !== 'granted') return
      }
    } catch {
      return
    }
    // A stop() (or newer start) arrived while the permission prompt was
    // up — this session is over before it began.
    if (generation !== generationRef.current || handlerRef.current) return
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
