/**
 * Route graph for keyboard navigation along light rail lines.
 *
 * The 1 Line and 2 Line share a north/downtown segment (Lynnwood through
 * Intl District/Chinatown). At International District Station the lines diverge:
 *   - 1 Line continues south to Stadium → Federal Way Downtown
 *   - 2 Line branches east to Judkins Park → Downtown Redmond
 *
 * Navigation tracks which line the user is "on" so traversal through
 * shared stations stays on the same line, and junction stations show
 * directional hints for line switching.
 *
 * Station names match Sound Transit's official current names.
 */

const LINE_1_ORDER = [
  'Lynnwood City Center Station',
  'Mountlake Terrace Station',
  'Shoreline North/185th Station',
  'Shoreline South/148th Station',
  'Northgate Station',
  'Roosevelt Station',
  'U District Station',
  'University of Washington Station',
  'Capitol Hill Station',
  'Westlake Station',
  'Symphony Station',
  'Pioneer Square Station',
  'International District Station',
  'Stadium Station',
  'SODO Station',
  'Beacon Hill Station',
  'Mount Baker Station',
  'Columbia City Station',
  'Othello Station',
  'Rainier Beach Station',
  'Tukwila International Blvd Station',
  'Airport / SeaTac Station',
  'Angle Lake Station',
  'Kent Des Moines Station',
  'Star Lake Station',
  'Federal Way Downtown Station',
]

const LINE_2_ORDER = [
  'Lynnwood City Center Station',
  'Mountlake Terrace Station',
  'Shoreline North/185th Station',
  'Shoreline South/148th Station',
  'Northgate Station',
  'Roosevelt Station',
  'U District Station',
  'University of Washington Station',
  'Capitol Hill Station',
  'Westlake Station',
  'Symphony Station',
  'Pioneer Square Station',
  'International District Station',
  'Judkins Park Station',
  'Mercer Island Station',
  'South Bellevue Station',
  'East Main Station',
  'Bellevue Downtown Station',
  'Wilburton Station',
  'Spring District/120th Station',
  'Bel-Red/130th Station',
  'Overlake Village Station',
  'Redmond Technology Center Station',
  'Marymoor Village Station',
  'Downtown Redmond Station',
]

const JUNCTION_STATION = 'International District Station'

const ARROW_BEARINGS = {
  ArrowUp: 0,
  ArrowRight: 90,
  ArrowDown: 180,
  ArrowLeft: 270,
}

function bearing(lngA, latA, lngB, latB) {
  const toRad = Math.PI / 180
  const dLng = (lngB - lngA) * toRad
  const lat1 = latA * toRad
  const lat2 = latB * toRad
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Build adjacency graph from station GeoJSON.
 * Each neighbor is tagged with its line so navigation can stay on the current line.
 */
export function buildGraph(stationsGeoJSON) {
  const stations = new Map()

  for (const f of stationsGeoJSON.features) {
    const name = f.properties.name
    const coords = f.geometry.coordinates
    const line = f.properties.line
    if (!stations.has(name)) {
      stations.set(name, { coords, lines: new Set([line]), neighbors: [] })
    } else {
      stations.get(name).lines.add(line)
    }
  }

  function wireAdjacency(order, lineId) {
    for (let i = 0; i < order.length; i++) {
      const cur = stations.get(order[i])
      if (!cur) continue
      cur.lines.add(lineId)

      if (i > 0) {
        const prev = stations.get(order[i - 1])
        if (prev && !cur.neighbors.some(n => n.name === order[i - 1] && n.line === lineId)) {
          cur.neighbors.push({ name: order[i - 1], coords: prev.coords, line: lineId })
        }
      }
      if (i < order.length - 1) {
        const next = stations.get(order[i + 1])
        if (next && !cur.neighbors.some(n => n.name === order[i + 1] && n.line === lineId)) {
          cur.neighbors.push({ name: order[i + 1], coords: next.coords, line: lineId })
        }
      }
    }
  }

  wireAdjacency(LINE_1_ORDER, '1-line')
  wireAdjacency(LINE_2_ORDER, '2-line')

  return stations
}

export function isJunction(graph, stationName) {
  return stationName === JUNCTION_STATION
}

// Reference for terminus direction. Bearing from this central station to a
// terminus picks the cardinal that matches the user's mental map of which
// "end" of the system the line runs off toward — instead of the local
// bearing over the last segment, which is noisy (e.g. Downtown Redmond
// sits slightly north of Marymoor Village even though Line 2 runs east).
const TERMINUS_REFERENCE = 'Westlake Station'

/**
 * If `stationName` is the start or end of either line order, return the
 * cardinal direction the line "points off the map" in (as the arrow key
 * the user can no longer travel) and which lines terminate here.
 * Returns null for non-terminus stations.
 */
export function getTerminusInfo(graph, stationName) {
  const node = graph.get(stationName)
  if (!node || node.neighbors.length === 0) return null

  const lines = []
  if (LINE_1_ORDER[0] === stationName || LINE_1_ORDER[LINE_1_ORDER.length - 1] === stationName) lines.push('1-line')
  if (LINE_2_ORDER[0] === stationName || LINE_2_ORDER[LINE_2_ORDER.length - 1] === stationName) lines.push('2-line')
  if (lines.length === 0) return null

  const reference = graph.get(TERMINUS_REFERENCE) || node.neighbors[0]
  const b = bearing(reference.coords[0], reference.coords[1], node.coords[0], node.coords[1])
  let bestKey = null
  let bestDiff = Infinity
  for (const [arrow, target] of Object.entries(ARROW_BEARINGS)) {
    const diff = angleDiff(b, target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestKey = arrow
    }
  }

  return { arrowKey: bestKey, lines }
}

/**
 * Get directional hints for a junction station.
 * Returns hints for the diverging directions only (not the shared north direction).
 */
export function getJunctionHints(graph, stationName) {
  if (!isJunction(graph, stationName)) return []

  const current = graph.get(stationName)
  if (!current) return []

  const hints = []
  const seen = new Set()

  for (const neighbor of current.neighbors) {
    const key = neighbor.name
    if (seen.has(key)) continue
    seen.add(key)

    const b = bearing(current.coords[0], current.coords[1], neighbor.coords[0], neighbor.coords[1])

    let bestKey = null
    let bestDiff = Infinity
    for (const [arrow, target] of Object.entries(ARROW_BEARINGS)) {
      const diff = angleDiff(b, target)
      if (diff < bestDiff) {
        bestDiff = diff
        bestKey = arrow
      }
    }

    const lineLabel = neighbor.line === '1-line' ? '1 Line' : '2 Line'
    hints.push({
      arrowKey: bestKey,
      line: neighbor.line,
      stationName: neighbor.name,
      label: `${lineLabel} → ${neighbor.name.replace(' Station', '')}`,
    })
  }

  // Only return hints for diverging directions (unique arrow keys)
  return hints.filter(h => {
    const sameArrow = hints.filter(h2 => h2.arrowKey === h.arrowKey)
    return sameArrow.length === 1
  })
}

/**
 * Navigate to next station, preferring the current line.
 * Returns { name, line } or null.
 */
export function getNextStation(graph, currentStationName, arrowKey, currentLine) {
  const targetBearing = ARROW_BEARINGS[arrowKey]
  if (targetBearing === undefined) return null

  const current = graph.get(currentStationName)
  if (!current || current.neighbors.length === 0) return null

  let bestName = null
  let bestLine = null
  let bestScore = Infinity

  for (const neighbor of current.neighbors) {
    const b = bearing(current.coords[0], current.coords[1], neighbor.coords[0], neighbor.coords[1])
    const diff = angleDiff(b, targetBearing)
    if (diff > 90) continue

    // Prefer staying on current line
    const lineBonus = (currentLine && neighbor.line === currentLine) ? -0.1 : 0
    const score = diff + lineBonus

    if (score < bestScore) {
      bestScore = score
      bestName = neighbor.name
      bestLine = neighbor.line
    }
  }

  if (!bestName) return null
  return { name: bestName, line: bestLine }
}
