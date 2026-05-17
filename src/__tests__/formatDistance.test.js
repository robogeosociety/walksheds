import { describe, it, expect } from 'vitest'
import { formatDistance, formatMinutes, formatWalk } from '../formatDistance'

describe('formatDistance', () => {
  describe('metric', () => {
    it('renders sub-1km in meters, rounded to 10m', () => {
      expect(formatDistance(412, 'metric')).toBe('410 m')
      expect(formatDistance(995, 'metric')).toBe('1000 m')
      expect(formatDistance(0, 'metric')).toBe('0 m')
    })

    it('renders >=1km in km with one decimal', () => {
      expect(formatDistance(1000, 'metric')).toBe('1.0 km')
      expect(formatDistance(1234, 'metric')).toBe('1.2 km')
      expect(formatDistance(2250, 'metric')).toBe('2.3 km')
    })
  })

  describe('imperial', () => {
    it('renders sub-0.1mi in feet, rounded to 10ft', () => {
      expect(formatDistance(30, 'imperial')).toBe('100 ft')
      expect(formatDistance(150, 'imperial')).toBe('490 ft')
    })

    it('renders >=0.1mi in miles with one decimal', () => {
      // ~528 ft is the threshold; 528 ft ≈ 161 m
      expect(formatDistance(161, 'imperial')).toBe('0.1 mi')
      expect(formatDistance(805, 'imperial')).toBe('0.5 mi')
      expect(formatDistance(1609, 'imperial')).toBe('1.0 mi')
    })
  })

  it('returns empty string for invalid input', () => {
    expect(formatDistance(null, 'metric')).toBe('')
    expect(formatDistance(undefined, 'metric')).toBe('')
    expect(formatDistance(-5, 'metric')).toBe('')
    expect(formatDistance(NaN, 'metric')).toBe('')
  })

  it('defaults to metric when units is unrecognized', () => {
    expect(formatDistance(500, 'unknown')).toBe('500 m')
  })
})

describe('formatMinutes', () => {
  it('rounds seconds to whole minutes, minimum 1', () => {
    expect(formatMinutes(30)).toBe('1 min')
    expect(formatMinutes(60)).toBe('1 min')
    expect(formatMinutes(90)).toBe('2 min')  // 1.5 → 2
    expect(formatMinutes(297)).toBe('5 min')  // 4.95 → 5
    expect(formatMinutes(900)).toBe('15 min')
  })

  it('returns empty string for invalid input', () => {
    expect(formatMinutes(null)).toBe('')
    expect(formatMinutes(undefined)).toBe('')
    expect(formatMinutes(-1)).toBe('')
  })
})

describe('formatWalk', () => {
  it('joins distance and time with a middle dot', () => {
    expect(formatWalk(412, 297, 'metric')).toBe('410 m · 5 min')
    expect(formatWalk(805, 580, 'imperial')).toBe('0.5 mi · 10 min')
  })

  it('falls back to whichever is present when one is missing', () => {
    expect(formatWalk(412, null, 'metric')).toBe('410 m')
    expect(formatWalk(null, 297, 'metric')).toBe('5 min')
    expect(formatWalk(null, null, 'metric')).toBe('')
  })
})
