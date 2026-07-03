import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEmbedBridge } from '../embedBridge'

function cfg(overrides = {}) {
  return { embed: true, chrome: {}, dark: null, units: null, origin: null, ...overrides }
}

function makeApi() {
  return {
    selectStationByCode: vi.fn(),
    applyWalksheds: vi.fn(),
    applyPoiFilterString: vi.fn(),
    setDarkMode: vi.fn(),
    setUnits: vi.fn(),
  }
}

function send(data, origin = 'https://host.example') {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }))
  })
}

let postSpy
beforeEach(() => {
  postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useEmbedBridge outbound', () => {
  it('posts ready on mount once station data is ready', () => {
    renderHook(() => useEmbedBridge({ config: cfg(), ready: true, api: makeApi(), popup: null, currentLine: null }))
    expect(postSpy).toHaveBeenCalledWith(
      { source: 'walksheds', type: 'ready', payload: {} },
      '*',
    )
  })

  it('pins the target origin when config.origin is set', () => {
    renderHook(() => useEmbedBridge({
      config: cfg({ origin: 'https://host.example' }),
      ready: true, api: makeApi(), popup: null, currentLine: null,
    }))
    expect(postSpy).toHaveBeenCalledWith(expect.anything(), 'https://host.example')
  })

  it('emits stationchange when the selected station changes', () => {
    const { rerender } = renderHook(
      ({ popup }) => useEmbedBridge({ config: cfg(), ready: true, api: makeApi(), popup, currentLine: '1-line' }),
      { initialProps: { popup: null } },
    )
    postSpy.mockClear()
    rerender({ popup: { name: 'Westlake Station', stopCode: 50, lines: '1,2', longitude: -122.3, latitude: 47.6, line: '1-line' } })
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'walksheds',
        type: 'stationchange',
        payload: expect.objectContaining({ name: 'Westlake Station', line: '1', stopCode: 50 }),
      }),
      '*',
    )
  })

  it('does nothing when not embedded', () => {
    const api = makeApi()
    renderHook(() => useEmbedBridge({ config: cfg({ embed: false }), ready: true, api, popup: null, currentLine: null }))
    expect(postSpy).not.toHaveBeenCalled()
    send({ source: 'walksheds-host', type: 'selectStation', payload: { line: '1', stopCode: 50 } })
    expect(api.selectStationByCode).not.toHaveBeenCalled()
  })
})

describe('useEmbedBridge inbound', () => {
  it('dispatches each whitelisted command to the api', () => {
    const api = makeApi()
    renderHook(() => useEmbedBridge({ config: cfg(), ready: true, api, popup: null, currentLine: null }))

    send({ source: 'walksheds-host', type: 'selectStation', payload: { line: '1', stopCode: 50 } })
    expect(api.selectStationByCode).toHaveBeenCalledWith('1', 50)

    send({ source: 'walksheds-host', type: 'setWalksheds', payload: { minutes: [5, 10] } })
    expect(api.applyWalksheds).toHaveBeenCalledWith([5, 10])

    send({ source: 'walksheds-host', type: 'setFilters', payload: { pois: 'coffee,park' } })
    expect(api.applyPoiFilterString).toHaveBeenCalledWith('coffee,park')

    send({ source: 'walksheds-host', type: 'setDark', payload: { dark: true } })
    expect(api.setDarkMode).toHaveBeenCalledWith(true)

    send({ source: 'walksheds-host', type: 'setUnits', payload: { units: 'imperial' } })
    expect(api.setUnits).toHaveBeenCalledWith('imperial')
  })

  it('ignores messages without the walksheds-host source (namespace guard)', () => {
    const api = makeApi()
    renderHook(() => useEmbedBridge({ config: cfg(), ready: true, api, popup: null, currentLine: null }))
    send({ source: 'someone-else', type: 'selectStation', payload: { line: '1', stopCode: 50 } })
    send({ type: 'selectStation', payload: { line: '1', stopCode: 50 } })
    expect(api.selectStationByCode).not.toHaveBeenCalled()
  })

  it('enforces the origin allowlist when config.origin is set', () => {
    const api = makeApi()
    renderHook(() => useEmbedBridge({
      config: cfg({ origin: 'https://host.example' }),
      ready: true, api, popup: null, currentLine: null,
    }))
    send({ source: 'walksheds-host', type: 'setDark', payload: { dark: true } }, 'https://evil.example')
    expect(api.setDarkMode).not.toHaveBeenCalled()
    send({ source: 'walksheds-host', type: 'setDark', payload: { dark: true } }, 'https://host.example')
    expect(api.setDarkMode).toHaveBeenCalledWith(true)
  })

  it('ignores unknown command types without throwing', () => {
    const api = makeApi()
    renderHook(() => useEmbedBridge({ config: cfg(), ready: true, api, popup: null, currentLine: null }))
    expect(() => send({ source: 'walksheds-host', type: 'launchMissiles', payload: {} })).not.toThrow()
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled()
  })
})
