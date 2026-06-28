import { describe, it, expect } from 'vitest'
import { buildFeedbackIssueUrl, REPORT_REASONS } from '../poiFeedback'

const POI = {
  id: 201028146,
  name: "Dick's Drive-In",
  category: 'fast_food',
  sources: ['osm', 'overture'],
  latitude: 47.6191,
  longitude: -122.3211,
  stations: [
    { stopCode: 49, lines: '1,2', name: 'Capitol Hill Station', walkingMeters: 350, walkingSeconds: 280, band: 5 },
  ],
}

// Decode the prefilled body back out of the issue URL for assertions.
function bodyOf(url) {
  return new URL(url).searchParams.get('body')
}

describe('buildFeedbackIssueUrl', () => {
  it('targets the walksheds repo new-issue endpoint with the poi-feedback label', () => {
    const url = new URL(buildFeedbackIssueUrl(POI, 'closed'))
    expect(url.origin + url.pathname).toBe('https://github.com/tommyroar/walksheds/issues/new')
    expect(url.searchParams.get('labels')).toBe('poi-feedback')
  })

  it('puts the reason and name in the title', () => {
    const title = new URL(buildFeedbackIssueUrl(POI, 'duplicate')).searchParams.get('title')
    expect(title).toBe("POI feedback: duplicate — Dick's Drive-In")
  })

  it('embeds the parseable identity block in the body', () => {
    const body = bodyOf(buildFeedbackIssueUrl(POI, 'inaccurate'))
    expect(body).toContain('Reason: inaccurate')
    expect(body).toContain('POI ID: 201028146')
    expect(body).toContain("Name: Dick's Drive-In")
    expect(body).toContain('Category: fast_food')
    expect(body).toContain('Sources: osm, overture')
    expect(body).toContain('Coordinates: 47.6191, -122.3211')
    expect(body).toContain('Nearest station: Capitol Hill Station (stopCode 49, lines 1,2)')
  })

  it('URL-encodes special characters in the body', () => {
    const raw = buildFeedbackIssueUrl(POI, 'closed')
    // The apostrophe and spaces must be percent-encoded, not left literal.
    expect(raw).not.toContain("Dick's Drive-In")
    expect(bodyOf(raw)).toContain("Dick's Drive-In")
  })

  it('omits absent fields and tolerates a missing id', () => {
    const body = bodyOf(buildFeedbackIssueUrl({ name: 'Mystery Spot' }, 'closed'))
    expect(body).toContain('POI ID: (unknown)')
    expect(body).not.toContain('Category:')
    expect(body).not.toContain('Coordinates:')
    expect(body).not.toContain('Nearest station:')
  })

  it('exposes the three flag reasons', () => {
    expect(REPORT_REASONS.map(r => r.key)).toEqual(['closed', 'duplicate', 'inaccurate'])
  })
})
