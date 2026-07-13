/**
 * Embed-mode configuration, parsed once from the URL query at startup.
 *
 * Walksheds is embedded by framing the live site with `?embed=1` (see
 * public/embed.js + public/embed.html + wiki/docs/embedding.md). Embed mode
 * strips onboarding/branding chrome, stops writing to the URL and localStorage
 * (the iframe runs on the walksheds.xyz origin, so its localStorage is shared
 * with the real site — an embed must not flip a visitor's stored prefs), and
 * opens the two-way postMessage bridge (see embedBridge.js).
 *
 * The config is a frozen, side-effect-free snapshot: `parseEmbedConfig` only
 * reads the query string, never touches history/storage.
 *
 * Query params (all optional; only read when `embed` is present):
 *   embed            master switch (?embed or ?embed=1)
 *   legend/search    show the legend / POI search (default on)
 *   hints            show onboarding overlay (default off in embed)
 *   help/guide       show the legend's help button / wiki link (default off)
 *   report/locate    show the POI report link / map locate control
 *                    (report default off, locate default on)
 *   feedback         show the legend "Send feedback" control (default off)
 *   darktoggle       show the legend dark-mode toggle (default on)
 *   unitstoggle      show the legend units (m/ft) toggle (default on)
 *   dark             force dark (1) or light (0); absent = no override
 *   units            force 'metric' or 'imperial'; absent = no override
 *   origin           pin the postMessage peer origin (e.g. https://host.example)
 *
 * Existing params still drive initial state in embed mode: the deep-link path
 * `/seattle/{line}/{stopCode}`, `?walkshed=`, and `?pois=`.
 */

// Chrome visibility defaults. In embed mode we hide onboarding and branding by
// default; a per-flag param (?embed=1&help=1) overrides any single default.
const CHROME_DEFAULTS_EMBED = {
  legend: true,
  search: true,
  hints: false,
  help: false,
  guide: false,
  report: false,
  feedback: false,
  locate: true,
  darkToggle: true,
  unitsToggle: true,
}

// Outside embed mode every affordance shows and nothing is suppressed, so the
// normal app is byte-for-byte unchanged.
const CHROME_DEFAULTS_NORMAL = {
  legend: true,
  search: true,
  hints: true,
  help: true,
  guide: true,
  report: true,
  feedback: true,
  locate: true,
  darkToggle: true,
  unitsToggle: true,
}

// URL param name (lowercase) → chrome key.
const CHROME_PARAM = {
  legend: 'legend',
  search: 'search',
  hints: 'hints',
  help: 'help',
  guide: 'guide',
  report: 'report',
  feedback: 'feedback',
  locate: 'locate',
  darktoggle: 'darkToggle',
  unitstoggle: 'unitsToggle',
}

// Parse a boolean-ish flag. A bare flag (?help) or truthy string counts as
// true; explicit 0/false/no as false; anything else falls back to `dflt`.
function parseBool(value, dflt) {
  if (value == null) return dflt
  const s = String(value).trim().toLowerCase()
  if (s === '' || s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return dflt
}

// Validate an origin string; return the canonical origin or null.
function parseOrigin(value) {
  if (!value) return null
  try {
    const origin = new URL(value).origin
    return origin && origin !== 'null' ? origin : null
  } catch {
    return null
  }
}

/**
 * Parse embed config from a query string (defaults to the live location).
 * Returns a frozen object; when not embedded, `chrome` is the all-visible
 * default set so callers can read `config.chrome.*` unconditionally.
 */
export function parseEmbedConfig(search) {
  const query = search != null
    ? search
    : (typeof window !== 'undefined' ? window.location.search : '')
  const params = new URLSearchParams(query)

  const embed = params.has('embed') && parseBool(params.get('embed'), true)
  if (!embed) {
    return Object.freeze({
      embed: false,
      chrome: Object.freeze({ ...CHROME_DEFAULTS_NORMAL }),
      dark: null,
      units: null,
      origin: null,
    })
  }

  const chrome = {}
  for (const [param, key] of Object.entries(CHROME_PARAM)) {
    chrome[key] = parseBool(params.get(param), CHROME_DEFAULTS_EMBED[key])
  }

  let dark = null
  if (params.has('dark')) dark = parseBool(params.get('dark'), true)

  let units = null
  if (params.has('units')) {
    const u = String(params.get('units')).trim().toLowerCase()
    if (u === 'metric' || u === 'imperial') units = u
  }

  return Object.freeze({
    embed: true,
    chrome: Object.freeze(chrome),
    dark,
    units,
    origin: parseOrigin(params.get('origin')),
  })
}
