/**
 * Route graph for keyboard navigation along rail lines.
 *
 * Line order is DERIVED from the station data, not hardcoded: a station's
 * `stopCode` is an ordinal along its line in every city the app covers (Sound
 * Transit's three-digit codes increase away from Westlake=50; HART's station IDs
 * run 1..21 west to east), so each line's order is its stations sorted by
 * stopCode. That is what makes this file city-agnostic — Seattle's two lines
 * with a shared downtown trunk and Honolulu's single Skyline line both fall out
 * of the same derivation.
 *
 * Where two or more lines share a leading run of stations, they diverge at the
 * last station of that common prefix — the junction, which gets directional
 * hints for line switching. A single-line city has no junction.
 *
 * Navigation tracks which line the user is "on" so traversal through shared
 * stations stays on the same line.
 */

const ARROW_BEARINGS = {
  ArrowUp: 0,
  ArrowRight: 90,
  ArrowDown: 180,
  ArrowLeft: 270,
}

/**
 * Per-line station order, derived from the station features.
 *
 * Returns a Map of line id → ordered station names. A station's `lines`
 * property is the comma-joined list of line keys it serves ('1', '2', '1,2'),
 * so a shared station appears in every line it belongs to.
 */
export function deriveLineOrders(stationsGeoJSON, city) {
  const orders = new Map()
  if (!city?.lines) return orders

  // One entry per (name, line) pair, deduplicated: shared stations are emitted
  // once per line in the GeoJSON for Seattle but only once overall elsewhere.
  for (const line of city.lines) {
    const seen = new Set()
    const rows = []
    for (const f of stationsGeoJSON.features) {
      const { name, lines, stopCode } = f.properties
      const keys = String(lines ?? '').split(',').map(k => k.trim()).filter(Boolean)
      // Fall back to the per-feature `line` id when `lines` is absent, so a
      // partial fixture still wires up.
      const serves = keys.length ? keys.includes(line.key) : f.properties.line === line.id
      if (!serves || seen.has(name)) continue
      seen.add(name)
      rows.push({ name, stopCode })
    }
    rows.sort((a, b) => (a.stopCode ?? 0) - (b.stopCode ?? 0))
    orders.set(line.id, rows.map(r => r.name))
  }
  return orders
}

/**
 * The station where the lines diverge: the last station shared by the leading
 * run of every line's order. `null` for a single-line city, or when the lines
 * share no common prefix.
 */
export function deriveJunction(orders) {
  const lists = [...orders.values()].filter(o => o.length > 0)
  if (lists.length < 2) return null
  let junction = null
  const shortest = Math.min(...lists.map(l => l.length))
  for (let i = 0; i < shortest; i++) {
    const name = lists[0][i]
    if (!lists.every(l => l[i] === name)) break
    junction = name
  }
  return junction
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
export function buildGraph(stationsGeoJSON, city) {
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

  const orders = deriveLineOrders(stationsGeoJSON, city)
  for (const [lineId, order] of orders) wireAdjacency(order, lineId)
  for (const [lineId, order] of orders) indexSegmentCardinals(stations, order, lineId)

  // Line metadata the navigation helpers need, carried on the graph so they
  // keep their (graph, stationName) signatures instead of reaching for globals.
  stations.meta = {
    orders,
    junction: deriveJunction(orders),
    lineLabels: new Map((city?.lines || []).map(l => [l.id, l.label])),
  }

  return stations
}

// A chord more than this far off a cardinal axis is "ambiguous" — eligible
// for the line-continuity correction below.
const AMBIGUOUS_OFF_DEG = 30

/**
 * Precompute the cardinal direction of every directed segment along a
 * line and stamp it on the neighbor entries, so navigation and the swipe
 * hint share one indexed answer.
 *
 * The cardinal is the chord bearing binned to the nearest axis — except
 * for ambiguous diagonals sandwiched between two segments that agree on a
 * different direction, which inherit that direction. This keeps the
 * gesture continuous along a line where the track jogs: Capitol Hill →
 * Westlake runs 236° (chord says "left") between two southbound segments,
 * so riders keep swiping the same way to continue downtown instead of
 * hitting a surprise sideways step. Genuine bends (Chinatown junction,
 * SODO → Beacon Hill, the Bellevue elbow) have unambiguous chords or
 * disagreeing surroundings and keep their geometric direction.
 *
 * A corrected diagonal also keeps its geometric chord as an *alternate*
 * accepted direction when heading up the line (toward the earlier station,
 * step < 0): Westlake → Capitol Hill (a NE jog) takes an Up OR a Right
 * swipe, since Capitol Hill sits up-and-to-the-right. The reverse
 * (southbound) keeps only its single continuity cardinal, so riding
 * downtown stays one direction (Capitol Hill → Westlake is Down, not Left).
 */
function indexSegmentCardinals(stations, order, lineId) {
  const coord = (name) => stations.get(name)?.coords

  // Returns { cardinal, altCardinal? } for the directed segment i → j.
  const segmentCardinals = (i, j) => {
    const a = coord(order[i])
    const b = coord(order[j])
    const brg = bearing(a[0], a[1], b[0], b[1])
    const chord = nearestCardinal(brg)
    if (angleDiff(brg, ARROW_BEARINGS[chord]) <= AMBIGUOUS_OFF_DEG) return { cardinal: chord }
    const step = j - i
    const beforeA = coord(order[i - step])
    const afterB = coord(order[j + step])
    if (!beforeA || !afterB) return { cardinal: chord }
    const prev = nearestCardinal(bearing(beforeA[0], beforeA[1], a[0], a[1]))
    const next = nearestCardinal(bearing(b[0], b[1], afterB[0], afterB[1]))
    if (prev === next && prev !== chord) {
      return step < 0 ? { cardinal: prev, altCardinal: chord } : { cardinal: prev }
    }
    return { cardinal: chord }
  }

  for (let i = 0; i < order.length; i++) {
    const cur = stations.get(order[i])
    if (!cur) continue
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= order.length || !stations.get(order[j])) continue
      const neighbor = cur.neighbors.find(n => n.name === order[j] && n.line === lineId)
      if (!neighbor) continue
      const { cardinal, altCardinal } = segmentCardinals(i, j)
      neighbor.cardinal = cardinal
      if (altCardinal) neighbor.altCardinal = altCardinal
      else delete neighbor.altCardinal
    }
  }
}

export function isJunction(graph, stationName) {
  const junction = graph?.meta?.junction
  return Boolean(junction) && stationName === junction
}

/**
 * If `stationName` is the start or end of any line order, return the
 * cardinal direction the line "points off the map" in (as the arrow key
 * the user can no longer travel) and which lines terminate here.
 * Returns null for non-terminus stations.
 *
 * Direction is the bearing _from_ the only on-line neighbor _to_ the
 * terminus station — i.e. the direction the train was moving as it
 * pulled into the last stop. Local-segment-based so the orientation
 * matches the actual rail approach (Marymoor Village → Downtown Redmond
 * runs north, even though Line 2 "goes east" overall).
 */
export function getTerminusInfo(graph, stationName) {
  const node = graph.get(stationName)
  if (!node || node.neighbors.length === 0) return null

  const lines = []
  for (const [lineId, order] of graph.meta?.orders || []) {
    if (order.length && (order[0] === stationName || order[order.length - 1] === stationName)) {
      lines.push(lineId)
    }
  }
  if (lines.length === 0) return null

  const neighbor = node.neighbors[0]
  const b = bearing(neighbor.coords[0], neighbor.coords[1], node.coords[0], node.coords[1])
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

    // Indexed at build time (see indexSegmentCardinals), so the hint
    // arrow matches what getNextStation will actually do.
    const arrowKey = neighbor.cardinal
      || nearestCardinal(bearing(current.coords[0], current.coords[1], neighbor.coords[0], neighbor.coords[1]))

    const lineLabel = graph.meta?.lineLabels?.get(neighbor.line) || neighbor.line
    hints.push({
      arrowKey,
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
 * The onboarding d-pad for the active station: one arm per navigable
 * cardinal, each pointing the direction of TRAVEL (screen direction of
 * the destination) and naming the station it reaches. Built directly on
 * getNextStation, so an arm can never disagree with what the arrow key
 * or swipe actually does. Order is clockwise from north.
 *
 * Returns [{ arrowKey, stationName, label, line }] — two arms at a
 * typical mid-line station, three at the Chinatown junction, one at a
 * terminus, [] for unknown stations.
 */
const DPAD_ORDER = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']

export function getDpadHints(graph, stationName, currentLine) {
  if (!graph || !graph.has(stationName)) return []
  const out = []
  for (const arrowKey of DPAD_ORDER) {
    const next = getNextStation(graph, stationName, arrowKey, currentLine)
    if (!next) continue
    out.push({
      arrowKey,
      stationName: next.name,
      label: next.name.replace(' Station', ''),
      line: next.line,
    })
  }
  return out
}

/**
 * Bin a bearing (0–360°) to the nearest cardinal arrow key. Ties (e.g. 45°
 * between Up and Right) resolve to whichever entry comes first in
 * ARROW_BEARINGS, which is Up → Right → Down → Left.
 */
function nearestCardinal(b) {
  let best = null
  let bestDiff = Infinity
  for (const [arrow, target] of Object.entries(ARROW_BEARINGS)) {
    const diff = angleDiff(b, target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = arrow
    }
  }
  return best
}

/**
 * Navigate to the next station in the direction of `arrowKey`.
 *
 * Only neighbors whose *indexed segment cardinal* (see
 * indexSegmentCardinals; falls back to the chord's nearest cardinal)
 * matches `arrowKey` are eligible — so at Pioneer Square (north + south
 * neighbors only) a left/right swipe returns null and the caller can let
 * the gesture fall through to map panning. At Chinatown the same logic
 * admits both south (Line 1 to Stadium) and east (Line 2 to Judkins
 * Park) as separate arrow-key results, which is exactly the junction
 * behavior we want.
 *
 * When multiple neighbors share the same cardinal (a shared-trunk
 * station has duplicate up/down neighbors, one per line), prefer the
 * one matching `currentLine`.
 */
export function getNextStation(graph, currentStationName, arrowKey, currentLine) {
  if (ARROW_BEARINGS[arrowKey] === undefined) return null
  const current = graph.get(currentStationName)
  if (!current || current.neighbors.length === 0) return null

  let best = null
  let bestScore = Infinity
  for (const neighbor of current.neighbors) {
    const cardinal = neighbor.cardinal
      || nearestCardinal(bearing(current.coords[0], current.coords[1], neighbor.coords[0], neighbor.coords[1]))
    // A corrected diagonal also answers to its geometric chord (altCardinal),
    // so e.g. Westlake → Capitol Hill accepts both Up and Right.
    if (cardinal !== arrowKey && neighbor.altCardinal !== arrowKey) continue
    const lineBonus = (currentLine && neighbor.line === currentLine) ? -0.1 : 0
    if (lineBonus < bestScore) {
      bestScore = lineBonus
      best = { name: neighbor.name, line: neighbor.line }
    }
  }
  return best
}
