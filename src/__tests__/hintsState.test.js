import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shouldShowHints, markHintsSeen } from '../hintsState'
import { hintsEnabled } from '../featureFlags'

const STORAGE_KEY = 'walksheds_hints_v1_seen'

function setLocation({ pathname = '/', search = '' } = {}) {
  delete window.location
  window.location = {
    pathname,
    search,
    hash: '',
    href: `http://localhost${pathname}${search}`,
  }
}

beforeEach(() => {
  // The overlay is behind a build flag; these cases cover the flag-on logic.
  vi.stubEnv('VITE_FEATURE_HINTS', '1')
  window.localStorage.clear()
  setLocation()
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('hints feature flag', () => {
  it('is off unless VITE_FEATURE_HINTS is exactly "1"', () => {
    expect(hintsEnabled({})).toBe(false)
    expect(hintsEnabled({ VITE_FEATURE_HINTS: 'true' })).toBe(false)
    expect(hintsEnabled({ VITE_FEATURE_HINTS: '1' })).toBe(true)
  })

  it('with the flag off, hints never show: not on first visit, not with ?hints', () => {
    vi.unstubAllEnvs()
    expect(shouldShowHints()).toBe(false)
    setLocation({ search: '?hints' })
    expect(shouldShowHints()).toBe(false)
  })
})

describe('shouldShowHints', () => {
  it('returns true on first visit at root path', () => {
    expect(shouldShowHints()).toBe(true)
  })

  it('returns false when storage flag is set', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    expect(shouldShowHints()).toBe(false)
  })

  it('returns true when ?hints is present, even with storage flag', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    setLocation({ search: '?hints' })
    expect(shouldShowHints()).toBe(true)
  })

  it('returns false when deep-linked to a station', () => {
    setLocation({ pathname: '/seattle/1/50' })
    expect(shouldShowHints()).toBe(false)
  })

  it('still returns true for deep-link + ?hints', () => {
    setLocation({ pathname: '/seattle/1/50', search: '?hints' })
    expect(shouldShowHints()).toBe(true)
  })

  it('returns false in embed mode', () => {
    setLocation({ search: '?embed=1' })
    expect(shouldShowHints()).toBe(false)
  })

  it('lets ?hints override embed mode', () => {
    setLocation({ search: '?embed=1&hints' })
    expect(shouldShowHints()).toBe(true)
  })
})

describe('markHintsSeen', () => {
  it('writes the storage key', () => {
    markHintsSeen()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('strips ?hints from the URL', () => {
    setLocation({ pathname: '/', search: '?hints' })
    markHintsSeen()
    expect(window.history.replaceState).toHaveBeenCalled()
    const call = window.history.replaceState.mock.calls[0]
    expect(call[2]).not.toContain('hints')
  })

  it('leaves other query params untouched', () => {
    setLocation({ pathname: '/seattle/1/50', search: '?hints&pois=coffee' })
    markHintsSeen()
    const call = window.history.replaceState.mock.calls[0]
    expect(call[2]).toContain('pois=coffee')
    expect(call[2]).not.toContain('hints')
  })
})
