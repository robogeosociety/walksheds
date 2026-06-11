import { describe, it, expect } from 'vitest'
import { matchStations } from '../stationSearch'

const feat = (name, stopCode, lines) => ({
  type: 'Feature',
  properties: { name, stopCode, lines, line: lines.startsWith('1') ? '1-line' : '2-line' },
  geometry: { type: 'Point', coordinates: [0, 0] },
})

const STATIONS = [
  feat('Westlake Station', 50, '1,2'),
  feat('Capitol Hill Station', 49, '1,2'),
  feat('Stadium Station', 54, '1'),
  feat('Judkins Park Station', 54, '2'),
  feat('Roosevelt Station', 46, '1,2'),
  feat('U District Station', 47, '1,2'),
  feat('Univ of Washington Station', 48, '1,2'),
  feat('SeaTac/Airport Station', 64, '1'),
]

describe('matchStations', () => {
  it('returns nothing for an empty query', () => {
    expect(matchStations(STATIONS, '')).toEqual([])
    expect(matchStations(STATIONS, '   ')).toEqual([])
  })

  it('matches by case-insensitive name substring', () => {
    const out = matchStations(STATIONS, 'roose')
    expect(out.map(f => f.properties.name)).toEqual(['Roosevelt Station'])
  })

  it('ranks prefix matches before substring matches', () => {
    const out = matchStations(STATIONS, 'sta')
    expect(out[0].properties.name).toBe('Stadium Station')
  })

  it('matches mid-name words like "airport"', () => {
    const out = matchStations(STATIONS, 'airport')
    expect(out.map(f => f.properties.name)).toEqual(['SeaTac/Airport Station'])
  })

  it('matches a two-digit stop code on every line that has it', () => {
    const out = matchStations(STATIONS, '54')
    expect(out.map(f => f.properties.name).sort()).toEqual([
      'Judkins Park Station',
      'Stadium Station',
    ])
  })

  it('disambiguates shared stop codes with a three-digit station code', () => {
    expect(matchStations(STATIONS, '154').map(f => f.properties.name)).toEqual(['Stadium Station'])
    expect(matchStations(STATIONS, '254').map(f => f.properties.name)).toEqual(['Judkins Park Station'])
  })

  it('matches three-digit codes for shared stations on either line digit', () => {
    expect(matchStations(STATIONS, '150').map(f => f.properties.name)).toEqual(['Westlake Station'])
    expect(matchStations(STATIONS, '250').map(f => f.properties.name)).toEqual(['Westlake Station'])
  })

  it('ignores single-digit and 4+ digit numeric queries', () => {
    expect(matchStations(STATIONS, '5')).toEqual([])
    expect(matchStations(STATIONS, '1500')).toEqual([])
  })

  it('caps results at three', () => {
    const out = matchStations(STATIONS, 'station')
    expect(out.length).toBe(3)
  })

  it('handles missing station data', () => {
    expect(matchStations(null, 'westlake')).toEqual([])
    expect(matchStations([], 'westlake')).toEqual([])
  })
})
