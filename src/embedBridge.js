/**
 * Two-way postMessage bridge for embedded Walksheds (see embedConfig.js).
 *
 * Only active when `config.embed` is true. It:
 *   - emits outbound events to the parent frame: `ready` (once station data
 *     loads) and `stationchange` (whenever the selected station changes);
 *   - accepts a fixed, non-destructive inbound command whitelist from the host.
 *
 * Message shapes:
 *   outbound  { source: 'walksheds',      type, payload }
 *   inbound   { source: 'walksheds-host', type, payload }
 *
 * Security: inbound messages are accepted only when tagged with the
 * `walksheds-host` source and (if `config.origin` is pinned via ?origin=) from
 * that exact origin. Every command only mutates map/filter React state — it
 * never touches storage, navigation, or the host window — so the surface is a
 * whitelist by construction. Outbound payloads carry only public map data, so
 * the default target origin is '*'; a host can pin it with ?origin=.
 */

import { useCallback, useEffect, useRef } from 'react'

const OUTBOUND_SOURCE = 'walksheds'
const INBOUND_SOURCE = 'walksheds-host'

/**
 * @param {object}   opts
 * @param {object}   opts.config       parsed embed config (embedConfig.js)
 * @param {boolean}  opts.ready        true once station data has loaded
 * @param {object}   opts.api          { selectStationByCode, applyWalksheds,
 *                                        applyPoiFilterString, setDarkMode, setUnits }
 * @param {object}   opts.popup        current station popup (or null)
 * @param {string}   opts.currentLine  current line id (e.g. '1-line')
 */
export function useEmbedBridge({ config, ready, api, popup, currentLine }) {
  const enabled = !!config?.embed
  const pinnedOrigin = config?.origin || null
  const targetOrigin = pinnedOrigin || '*'

  // Keep the latest api without re-subscribing the message listener.
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })

  const post = useCallback((type, payload) => {
    if (!enabled || typeof window === 'undefined') return
    try {
      window.parent.postMessage({ source: OUTBOUND_SOURCE, type, payload }, targetOrigin)
    } catch {
      /* postMessage can throw in exotic cross-origin cases; ignore */
    }
  }, [enabled, targetOrigin])

  // Inbound command listener.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const onMessage = (event) => {
      const data = event.data
      if (!data || data.source !== INBOUND_SOURCE || typeof data.type !== 'string') return
      if (pinnedOrigin && event.origin !== pinnedOrigin) return
      const payload = data.payload || {}
      const a = apiRef.current || {}
      switch (data.type) {
        case 'selectStation':
          if (payload.line != null && payload.stopCode != null) {
            a.selectStationByCode?.(payload.line, payload.stopCode)
          }
          break
        case 'setWalksheds':
          a.applyWalksheds?.(payload.minutes)
          break
        case 'setFilters':
          a.applyPoiFilterString?.(payload.pois ?? '')
          break
        case 'setDark':
          a.setDarkMode?.(!!payload.dark)
          break
        case 'setUnits':
          if (payload.units === 'metric' || payload.units === 'imperial') {
            a.setUnits?.(payload.units)
          }
          break
        default:
          break // unknown command: ignore silently
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [enabled, pinnedOrigin])

  // Emit `ready` once station data has loaded.
  const readySentRef = useRef(false)
  useEffect(() => {
    if (!enabled || !ready || readySentRef.current) return
    readySentRef.current = true
    post('ready', {})
  }, [enabled, ready, post])

  // Emit `stationchange` whenever the selected station changes.
  useEffect(() => {
    if (!enabled || !popup) return
    const lineId = currentLine || popup.line || ''
    post('stationchange', {
      name: popup.name,
      line: lineId.replace('-line', ''),
      stopCode: popup.stopCode,
      lines: popup.lines,
      lng: popup.longitude,
      lat: popup.latitude,
    })
  }, [enabled, popup, currentLine, post])
}
