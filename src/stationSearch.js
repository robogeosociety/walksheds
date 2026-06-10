// Station lookup for the search box (issue #18). Matches stations by name
// ("roosevelt", "intl district") or by number — either the two-digit stop
// code shared by both lines ("50") or the full three-digit Sound Transit
// station code whose first digit is the line ("150" = Line 1 stop 50,
// "258" = Bellevue Downtown). See CLAUDE.md "Station Codes".

const MAX_STATION_MATCHES = 3

function stationLines(feature) {
  return (feature.properties.lines || '').split(',').map(s => s.trim())
}

/**
 * Return up to MAX_STATION_MATCHES station features matching the query.
 * Name matches rank prefix hits first, then substring hits, alphabetical
 * within each rank. Numeric queries must match a stop code exactly (2
 * digits) or a line-qualified station code (3 digits) — single digits are
 * too ambiguous to be useful.
 */
export function matchStations(features, query) {
  if (!features?.length) return []
  const q = (query || '').trim().toLowerCase()
  if (!q) return []

  if (/^\d+$/.test(q)) {
    if (q.length === 2) {
      return features
        .filter(f => String(f.properties.stopCode) === q)
        .slice(0, MAX_STATION_MATCHES)
    }
    if (q.length === 3) {
      const line = q[0]
      const stop = String(parseInt(q.slice(1), 10))
      return features
        .filter(f => String(f.properties.stopCode) === stop && stationLines(f).includes(line))
        .slice(0, MAX_STATION_MATCHES)
    }
    return []
  }

  const scored = []
  for (const f of features) {
    const name = (f.properties.name || '').toLowerCase()
    if (!name.includes(q)) continue
    scored.push({ f, rank: name.startsWith(q) ? 0 : 1, name })
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  return scored.slice(0, MAX_STATION_MATCHES).map(s => s.f)
}
