/**
 * Deep linking utilities for station URLs.
 *
 * URL format: /walksheds/{line}/{stopCode}?walkshed=5&walkshed=10
 * Example:    /walksheds/1/50  →  Westlake Station on Line 1
 */

import { WALKSHED_OPTIONS } from './constants'

const VALID_LINES = new Set(['1', '2'])

/**
 * Parse a station path into line and stop code.
 * Returns { line, stopCode } or null if the path doesn't match.
 */
export function parseStationPath(pathname, basePath) {
  let rel = pathname
  if (basePath && rel.startsWith(basePath)) {
    rel = rel.slice(basePath.length)
  }
  rel = rel.replace(/^\/+|\/+$/g, '')
  if (!rel) return null

  const parts = rel.split('/')
  if (parts.length !== 2) return null

  const [line, codeStr] = parts
  if (!VALID_LINES.has(line)) return null

  const stopCode = parseInt(codeStr, 10)
  if (isNaN(stopCode)) return null

  return { line, stopCode }
}

/**
 * Build a station URL path.
 */
export function buildStationPath(line, stopCode, basePath) {
  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  return `${base}${line}/${stopCode}`
}

/**
 * Find a station feature by line + stop code in the GeoJSON data.
 * For shared stations, either line is valid.
 * For exclusive stations, the line must match.
 * Returns { name, lng, lat, line } or null.
 */
export function findStationByCode(stationsGeoJSON, line, stopCode) {
  const lineId = `${line}-line`
  for (const f of stationsGeoJSON.features) {
    const props = f.properties
    if (props.stopCode !== stopCode) continue
    const stationLines = props.lines.split(',').map(l => l.trim())
    if (stationLines.includes(line)) {
      return {
        name: props.name,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        line: lineId,
      }
    }
  }
  return null
}

/**
 * Parse ?walkshed= query params into a Set of minutes.
 * Returns null if no walkshed params (caller should use defaults).
 */
export function parseWalkshedParams(search) {
  const params = new URLSearchParams(search)
  const values = params.getAll('walkshed')
  if (values.length === 0) return null

  const set = new Set()
  for (const v of values) {
    const n = parseInt(v, 10)
    if (WALKSHED_OPTIONS.includes(n)) set.add(n)
  }
  return set.size > 0 ? set : null
}

/**
 * Build walkshed query string. Returns empty string when all options are enabled (default).
 */
export function buildWalkshedParams(enabledSet) {
  if (enabledSet.size === WALKSHED_OPTIONS.length) return ''
  if (enabledSet.size === 0) return ''
  const sorted = [...enabledSet].sort((a, b) => a - b)
  return '?' + sorted.map(m => `walkshed=${m}`).join('&')
}

/**
 * Combine multiple `?…`-prefixed query strings into a single one. Each part
 * may be '' or start with '?'. Returns '' or a single '?'-prefixed string.
 */
export function combineQuery(...parts) {
  const segments = []
  for (const p of parts) {
    if (!p) continue
    segments.push(p.startsWith('?') ? p.slice(1) : p)
  }
  return segments.length ? '?' + segments.join('&') : ''
}
