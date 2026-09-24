// Station lookup for the search box (issue #18). Matches stations by name
// ("roosevelt", "intl district") or by number — either the two-digit stop
// code shared by both lines ("50") or the full three-digit Sound Transit
// station code whose first digit is the line ("150" = Line 1 stop 50,
// "258" = Bellevue Downtown). See CLAUDE.md "Station Codes".
//
// Matching also covers a station's `altName` (the place descriptor riders
// navigate by, e.g. Kalauao → "Pearlridge") and is diacritic-insensitive, so
// Skyline's Hawaiian names are reachable from an ASCII keyboard: "halawa"
// finds Hālawa and "hoaeae" finds Hōʻaeʻae.

const MAX_STATION_MATCHES = 3

// U+02BB ʻokina and the curly quotes that stand in for it are dropped rather
// than folded to "'", so a query never has to guess which glyph a name uses.
const OKINA_LIKE = /[\u02bb\u2018\u2019']/g

/** Lowercase, strip combining diacritics and ʻokina — the search key. */
export function foldName(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(OKINA_LIKE, '')
    .toLowerCase()
}

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

  const needle = foldName(q)
  const scored = []
  for (const f of features) {
    const name = foldName(f.properties.name)
    const alt = foldName(f.properties.altName)
    // A hit on the official name outranks one on the descriptor, so searching
    // "pearl" surfaces Pearl Highlands (a name) above Kalauao (alt "Pearlridge").
    let rank = null
    if (name.startsWith(needle)) rank = 0
    else if (alt && alt.startsWith(needle)) rank = 1
    else if (name.includes(needle)) rank = 2
    else if (alt && alt.includes(needle)) rank = 3
    if (rank === null) continue
    scored.push({ f, rank, name })
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  return scored.slice(0, MAX_STATION_MATCHES).map(s => s.f)
}
