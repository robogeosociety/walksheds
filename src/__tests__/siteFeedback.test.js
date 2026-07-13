import { describe, it, expect } from 'vitest'
import { buildSiteFeedbackIssueUrl, SITE_FEEDBACK_REASONS } from '../siteFeedback'

const CONTEXT = {
  url: 'https://walksheds.xyz/seattle/1/50?walkshed=15',
  viewport: '390x844',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
}

// Decode the prefilled body back out of the issue URL for assertions.
function bodyOf(url) {
  return new URL(url).searchParams.get('body')
}

describe('buildSiteFeedbackIssueUrl', () => {
  it('targets the walksheds repo new-issue endpoint with the site-feedback label', () => {
    const url = new URL(buildSiteFeedbackIssueUrl('bug', CONTEXT))
    expect(url.origin + url.pathname).toBe('https://github.com/robogeosociety/walksheds/issues/new')
    expect(url.searchParams.get('labels')).toBe('site-feedback')
  })

  it('puts the reason in the title', () => {
    const title = new URL(buildSiteFeedbackIssueUrl('idea', CONTEXT)).searchParams.get('title')
    expect(title).toBe('Site feedback: idea')
  })

  it('embeds the parseable context block in the body', () => {
    const body = bodyOf(buildSiteFeedbackIssueUrl('bug', CONTEXT))
    expect(body).toContain('Reason: bug')
    expect(body).toContain('Page: https://walksheds.xyz/seattle/1/50?walkshed=15')
    expect(body).toContain('Viewport: 390x844')
    expect(body).toContain('User agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')
    expect(body).toContain('Additional details:')
  })

  it('URL-encodes special characters in the body', () => {
    const raw = buildSiteFeedbackIssueUrl('bug', CONTEXT)
    // Spaces and the semicolon must be percent-encoded, not left literal.
    expect(raw).not.toContain('Reason: bug')
    expect(bodyOf(raw)).toContain('Reason: bug')
  })

  it('omits absent context lines and tolerates no context', () => {
    const body = bodyOf(buildSiteFeedbackIssueUrl('other'))
    expect(body).toContain('Reason: other')
    expect(body).not.toContain('Page:')
    expect(body).not.toContain('Viewport:')
    expect(body).not.toContain('User agent:')
  })

  it('exposes the three feedback reasons', () => {
    expect(SITE_FEEDBACK_REASONS.map(r => r.key)).toEqual(['bug', 'idea', 'other'])
  })
})
