// POI feedback queue (issue #N): the app is a static GitHub Pages SPA with no
// backend, so a report can't be POSTed anywhere from the browser. Instead the
// popup's "Report a problem" control opens a prefilled GitHub issue in a new
// tab, labeled `poi-feedback`, with the listing's identity baked into the body.
// An agent later lists issues with that label and batch-applies fixes (extend
// DENY_OSM_IDS, rebuild tiles, close the issue). See docs/poi-feedback.md.

// Matches public/CNAME / CLAUDE.md. Kept here so the URL builder is self-contained.
const REPO = 'tommyroar/walksheds'
const FEEDBACK_LABEL = 'poi-feedback'

// The three flag reasons surfaced as chips in the popup.
export const REPORT_REASONS = [
  { key: 'closed', label: 'Closed' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'inaccurate', label: 'Inaccurate' },
]

// A stable, machine-parseable `key: value` block so the triage agent can pull a
// listing's identity out of the issue body without scraping prose. Lines are
// only emitted when the underlying field is present.
function buildBody(poi, reason) {
  const lines = [
    'Reported from the Walksheds map. Please leave the block below intact so it can be batch-processed.',
    '',
    `Reason: ${reason}`,
    `POI ID: ${poi.id ?? '(unknown)'}`,
    `Name: ${poi.name ?? '(unknown)'}`,
  ]
  if (poi.category) lines.push(`Category: ${poi.category}`)
  if (Array.isArray(poi.sources) && poi.sources.length) {
    lines.push(`Sources: ${poi.sources.join(', ')}`)
  }
  if (poi.latitude != null && poi.longitude != null) {
    lines.push(`Coordinates: ${poi.latitude}, ${poi.longitude}`)
  }
  const nearest = Array.isArray(poi.stations) ? poi.stations[0] : null
  if (nearest) {
    lines.push(`Nearest station: ${nearest.name} (stopCode ${nearest.stopCode}, lines ${nearest.lines})`)
  }
  lines.push('', 'Additional details:', '')
  return lines.join('\n')
}

// Build the prefilled GitHub "new issue" URL for a POI report. `reason` is a
// REPORT_REASONS key (closed / duplicate / inaccurate).
export function buildFeedbackIssueUrl(poi, reason) {
  const title = `POI feedback: ${reason} — ${poi.name ?? 'unknown listing'}`
  const params = new URLSearchParams({
    title,
    body: buildBody(poi, reason),
    labels: FEEDBACK_LABEL,
  })
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}
