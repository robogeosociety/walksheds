import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shouldShowHints, markHintsSeen } from '../hintsState'

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
  window.localStorage.clear()
  setLocation()
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
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
