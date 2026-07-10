// Site feedback queue: like POI feedback (see poiFeedback.js), the app is a
// static GitHub Pages SPA with no backend, so a report can't be POSTed anywhere
// from the browser. The legend's "Send feedback" control opens a prefilled
// GitHub issue in a new tab, labeled `site-feedback`, with the reason and the
// current page context baked into the body. An agent later lists issues with
// that label and triages them. See docs/site-feedback.md.

// Matches public/CNAME / CLAUDE.md. Kept here so the URL builder is self-contained.
const REPO = 'robogeosociety/walksheds'
const FEEDBACK_LABEL = 'site-feedback'

// The reasons surfaced as chips under the legend's "Send feedback" control.
export const SITE_FEEDBACK_REASONS = [
  { key: 'bug', label: 'Bug' },
  { key: 'idea', label: 'Idea' },
  { key: 'other', label: 'Other' },
]

// A stable, machine-parseable `key: value` block so a triage agent can pull the
// report's context out of the issue body without scraping prose. Context lines
// are only emitted when the underlying field is present.
function buildBody(reason, context) {
  const lines = [
    'Reported from the Walksheds map. Please leave the block below intact so it can be triaged.',
    '',
    `Reason: ${reason}`,
  ]
  if (context.url) lines.push(`Page: ${context.url}`)
  if (context.viewport) lines.push(`Viewport: ${context.viewport}`)
  if (context.userAgent) lines.push(`User agent: ${context.userAgent}`)
  lines.push('', 'Additional details:', '')
  return lines.join('\n')
}

// Build the prefilled GitHub "new issue" URL for a site-feedback report.
// `reason` is a SITE_FEEDBACK_REASONS key (bug / idea / other); `context`
// carries the current page/viewport/user-agent captured at click time.
export function buildSiteFeedbackIssueUrl(reason, context = {}) {
  const title = `Site feedback: ${reason}`
  const params = new URLSearchParams({
    title,
    body: buildBody(reason, context),
    labels: FEEDBACK_LABEL,
  })
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}
