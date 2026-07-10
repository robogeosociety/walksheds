import { describe, it, expect } from 'vitest'
import { parseEmbedConfig } from '../embedConfig'

describe('parseEmbedConfig', () => {
  it('returns non-embed defaults when ?embed is absent (app unchanged)', () => {
    const c = parseEmbedConfig('')
    expect(c.embed).toBe(false)
    // Every affordance visible; no value overrides.
    for (const key of Object.keys(c.chrome)) expect(c.chrome[key]).toBe(true)
    expect(c.dark).toBeNull()
    expect(c.units).toBeNull()
    expect(c.origin).toBeNull()
  })

  it('enables embed via bare ?embed and ?embed=1', () => {
    expect(parseEmbedConfig('?embed').embed).toBe(true)
    expect(parseEmbedConfig('?embed=1').embed).toBe(true)
    expect(parseEmbedConfig('?embed=0').embed).toBe(false)
    expect(parseEmbedConfig('?embed=false').embed).toBe(false)
  })

  it('applies embed chrome defaults: onboarding/branding hidden, map+controls shown', () => {
    const { chrome } = parseEmbedConfig('?embed=1')
    expect(chrome.hints).toBe(false)
    expect(chrome.help).toBe(false)
    expect(chrome.guide).toBe(false)
    expect(chrome.report).toBe(false)
    expect(chrome.feedback).toBe(false)
    expect(chrome.legend).toBe(true)
    expect(chrome.search).toBe(true)
    expect(chrome.locate).toBe(true)
    expect(chrome.darkToggle).toBe(true)
    expect(chrome.unitsToggle).toBe(true)
  })

  it('honors per-flag chrome overrides', () => {
    const { chrome } = parseEmbedConfig('?embed=1&legend=0&search=0&help=1&locate=0&feedback=1')
    expect(chrome.legend).toBe(false)
    expect(chrome.search).toBe(false)
    expect(chrome.help).toBe(true)
    expect(chrome.locate).toBe(false)
    expect(chrome.feedback).toBe(true)
  })

  it('parses dark and units value overrides', () => {
    const c = parseEmbedConfig('?embed=1&dark=1&units=imperial')
    expect(c.dark).toBe(true)
    expect(c.units).toBe('imperial')

    expect(parseEmbedConfig('?embed=1&dark=0').dark).toBe(false)
    expect(parseEmbedConfig('?embed=1&units=metric').units).toBe('metric')
  })

  it('leaves overrides null when absent or invalid', () => {
    const c = parseEmbedConfig('?embed=1&units=furlongs')
    expect(c.dark).toBeNull()
    expect(c.units).toBeNull()
  })

  it('validates the origin param', () => {
    expect(parseEmbedConfig('?embed=1&origin=https://host.example').origin)
      .toBe('https://host.example')
    expect(parseEmbedConfig('?embed=1&origin=not-a-url').origin).toBeNull()
    expect(parseEmbedConfig('?embed=1').origin).toBeNull()
  })

  it('returns a frozen config and frozen chrome', () => {
    const c = parseEmbedConfig('?embed=1')
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.chrome)).toBe(true)
  })
})
