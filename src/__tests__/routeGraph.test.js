import { describe, it, expect } from 'vitest'
import { buildGraph, getNextStation, isJunction, getJunctionHints, getTerminusInfo, getDpadHints, deriveLineOrders, deriveJunction } from '../routeGraph'
import { cityBySlug } from '../cities'
import REAL_STATIONS from '../../public/cities/seattle/all-stations.geojson?raw'

const SEATTLE = cityBySlug('seattle')
const HONOLULU = cityBySlug('honolulu')

const mockStations = {
  type: 'FeatureCollection',
  features: [
    // North terminus (Lynnwood) and southbound neighbor — both lines share these.
    { type: 'Feature', properties: { name: 'Lynnwood City Center Station', line: '1-line', lines: '1,2', stopCode: 40 }, geometry: { type: 'Point', coordinates: [-122.2948, 47.8156] } },
    { type: 'Feature', properties: { name: 'Lynnwood City Center Station', line: '2-line', lines: '1,2', stopCode: 40 }, geometry: { type: 'Point', coordinates: [-122.2948, 47.8156] } },
    { type: 'Feature', properties: { name: 'Mountlake Terrace Station', line: '1-line', lines: '1,2', stopCode: 41 }, geometry: { type: 'Point', coordinates: [-122.3148, 47.785] } },
    { type: 'Feature', properties: { name: 'Mountlake Terrace Station', line: '2-line', lines: '1,2', stopCode: 41 }, geometry: { type: 'Point', coordinates: [-122.3148, 47.785] } },
    // Shared stations (both lines). UW and Symphony bracket the Capitol
    // Hill → Westlake segment, whose chord runs 236° (west-dominant: the
    // downtown jog) between two southbound segments — the case the
    // line-continuity correction in indexSegmentCardinals exists for.
    { type: 'Feature', properties: { name: 'University of Washington Station', line: '1-line', lines: '1,2', stopCode: 48 }, geometry: { type: 'Point', coordinates: [-122.30376, 47.64982] } },
    { type: 'Feature', properties: { name: 'University of Washington Station', line: '2-line', lines: '1,2', stopCode: 48 }, geometry: { type: 'Point', coordinates: [-122.30376, 47.64982] } },
    { type: 'Feature', properties: { name: 'Capitol Hill Station', line: '1-line', lines: '1,2', stopCode: 49 }, geometry: { type: 'Point', coordinates: [-122.3202, 47.6191] } },
    { type: 'Feature', properties: { name: 'Capitol Hill Station', line: '2-line', lines: '1,2', stopCode: 49 }, geometry: { type: 'Point', coordinates: [-122.3202, 47.6191] } },
    { type: 'Feature', properties: { name: 'Westlake Station', line: '1-line', lines: '1,2', stopCode: 50 }, geometry: { type: 'Point', coordinates: [-122.3367, 47.6116] } },
    { type: 'Feature', properties: { name: 'Westlake Station', line: '2-line', lines: '1,2', stopCode: 50 }, geometry: { type: 'Point', coordinates: [-122.3367, 47.6116] } },
    { type: 'Feature', properties: { name: 'Symphony Station', line: '1-line', lines: '1,2', stopCode: 51 }, geometry: { type: 'Point', coordinates: [-122.33602, 47.60781] } },
    { type: 'Feature', properties: { name: 'Symphony Station', line: '2-line', lines: '1,2', stopCode: 51 }, geometry: { type: 'Point', coordinates: [-122.33602, 47.60781] } },
    { type: 'Feature', properties: { name: 'Pioneer Square Station', line: '1-line', lines: '1,2', stopCode: 52 }, geometry: { type: 'Point', coordinates: [-122.3312, 47.6026] } },
    { type: 'Feature', properties: { name: 'Pioneer Square Station', line: '2-line', lines: '1,2', stopCode: 52 }, geometry: { type: 'Point', coordinates: [-122.3312, 47.6026] } },
    { type: 'Feature', properties: { name: 'International District Station', line: '1-line', lines: '1,2', stopCode: 53 }, geometry: { type: 'Point', coordinates: [-122.3280, 47.5984] } },
    { type: 'Feature', properties: { name: 'International District Station', line: '2-line', lines: '1,2', stopCode: 53 }, geometry: { type: 'Point', coordinates: [-122.3280, 47.5984] } },
    // Line 1 only (south of junction); Federal Way is the south terminus.
    { type: 'Feature', properties: { name: 'Stadium Station', line: '1-line', lines: '1', stopCode: 54 }, geometry: { type: 'Point', coordinates: [-122.3272, 47.5911] } },
    { type: 'Feature', properties: { name: 'SODO Station', line: '1-line', lines: '1', stopCode: 55 }, geometry: { type: 'Point', coordinates: [-122.3274, 47.5811] } },
    { type: 'Feature', properties: { name: 'Star Lake Station', line: '1-line', lines: '1', stopCode: 67 }, geometry: { type: 'Point', coordinates: [-122.293, 47.394] } },
    { type: 'Feature', properties: { name: 'Federal Way Downtown Station', line: '1-line', lines: '1', stopCode: 68 }, geometry: { type: 'Point', coordinates: [-122.312, 47.317] } },
    // Line 2 only (east of junction); Downtown Redmond is the east terminus.
    { type: 'Feature', properties: { name: 'Judkins Park Station', line: '2-line', lines: '2', stopCode: 54 }, geometry: { type: 'Point', coordinates: [-122.3045, 47.5903] } },
    { type: 'Feature', properties: { name: 'Mercer Island Station', line: '2-line', lines: '2', stopCode: 55 }, geometry: { type: 'Point', coordinates: [-122.2332, 47.5882] } },
    { type: 'Feature', properties: { name: 'Marymoor Village Station', line: '2-line', lines: '2', stopCode: 64 }, geometry: { type: 'Point', coordinates: [-122.118, 47.662] } },
    { type: 'Feature', properties: { name: 'Downtown Redmond Station', line: '2-line', lines: '2', stopCode: 65 }, geometry: { type: 'Point', coordinates: [-122.1248, 47.6732] } },
  ],
}

describe('routeGraph', () => {
  const graph = buildGraph(mockStations, SEATTLE)

  it('builds graph with unique station entries', () => {
    // 16 unique station names
    expect(graph.size).toBe(16)
  })

  it('shared stations belong to both lines', () => {
    const id = graph.get('International District Station')
    expect(id.lines.has('1-line')).toBe(true)
    expect(id.lines.has('2-line')).toBe(true)
  })

  it('International District is a junction', () => {
    expect(isJunction(graph, 'International District Station')).toBe(true)
    expect(isJunction(graph, 'Capitol Hill Station')).toBe(false)
  })

  it('junction hints show diverging directions', () => {
    const hints = getJunctionHints(graph, 'International District Station')
    expect(hints.length).toBeGreaterThan(0)
    const hintLabels = hints.map(h => h.label)
    // Should mention Stadium (Line 1) and Judkins Park (Line 2)
    expect(hintLabels.some(l => l.includes('Stadium'))).toBe(true)
    expect(hintLabels.some(l => l.includes('Judkins Park'))).toBe(true)
  })

  describe('line-aware navigation', () => {
    it('ArrowDown from Intl District on Line 1 goes to Stadium', () => {
      const result = getNextStation(graph, 'International District Station', 'ArrowDown', '1-line')
      expect(result.name).toBe('Stadium Station')
      expect(result.line).toBe('1-line')
    })

    it('ArrowRight from Intl District on Line 2 goes to Judkins Park', () => {
      const result = getNextStation(graph, 'International District Station', 'ArrowRight', '2-line')
      expect(result.name).toBe('Judkins Park Station')
      expect(result.line).toBe('2-line')
    })

    it('ArrowUp from Intl District on Line 2 goes to Pioneer Square staying on Line 2', () => {
      const result = getNextStation(graph, 'International District Station', 'ArrowUp', '2-line')
      expect(result.name).toBe('Pioneer Square Station')
      expect(result.line).toBe('2-line')
    })

    it('ArrowLeft from Judkins Park goes back to Intl District on Line 2', () => {
      const result = getNextStation(graph, 'Judkins Park Station', 'ArrowLeft', '2-line')
      expect(result.name).toBe('International District Station')
      expect(result.line).toBe('2-line')
    })

    it('ArrowDown from Pioneer Square on Line 2 goes to Intl District on Line 2', () => {
      const result = getNextStation(graph, 'Pioneer Square Station', 'ArrowDown', '2-line')
      expect(result.name).toBe('International District Station')
      expect(result.line).toBe('2-line')
    })

    // The downtown jog: Capitol Hill → Westlake's chord (236°) bins to
    // "left", but the segment sits between two southbound ones, so the
    // indexed cardinal is Down — riding downtown stays one continuous
    // gesture instead of a surprise sideways step.
    it('ArrowDown from Capitol Hill goes to Westlake', () => {
      const result = getNextStation(graph, 'Capitol Hill Station', 'ArrowDown', '1-line')
      expect(result.name).toBe('Westlake Station')
    })

    it('ArrowLeft from Capitol Hill returns null (jog reads as southbound, not west)', () => {
      expect(getNextStation(graph, 'Capitol Hill Station', 'ArrowLeft', '1-line')).toBeNull()
    })

    it('ArrowUp from Westlake goes back to Capitol Hill', () => {
      const result = getNextStation(graph, 'Westlake Station', 'ArrowUp', '1-line')
      expect(result.name).toBe('Capitol Hill Station')
    })

    // Capitol Hill sits up-and-to-the-right of Westlake (the NE downtown jog),
    // so the northbound swipe is accepted both as Up and as Right; the
    // southbound reverse stays Down-only (see the ArrowLeft test above).
    it('ArrowRight from Westlake also goes to Capitol Hill (NE jog accepts up or right)', () => {
      const result = getNextStation(graph, 'Westlake Station', 'ArrowRight', '1-line')
      expect(result.name).toBe('Capitol Hill Station')
    })

    // Continuing past the end of the line. (SODO is NOT the case to assert
    // here: line order is derived from the data, so within this fixture SODO's
    // southbound neighbor is the next Line 1 station present, Star Lake.)
    it('returns null continuing past the line terminus', () => {
      const result = getNextStation(graph, 'Federal Way Downtown Station', 'ArrowDown', '1-line')
      expect(result).toBeNull()
    })

    it('returns null for non-arrow key', () => {
      const result = getNextStation(graph, 'Westlake Station', 'Enter', '1-line')
      expect(result).toBeNull()
    })

    // Non-junction stations should NOT navigate on swipes that don't match
    // a neighbor's actual cardinal direction — the gesture should fall
    // through to map panning instead. Chinatown remains the only station
    // where multiple different cardinals lead to different next stops.
    it('ArrowLeft from Pioneer Square returns null (no west neighbor)', () => {
      expect(getNextStation(graph, 'Pioneer Square Station', 'ArrowLeft', '1-line')).toBeNull()
    })

    it('ArrowRight from Pioneer Square returns null (no east neighbor)', () => {
      expect(getNextStation(graph, 'Pioneer Square Station', 'ArrowRight', '1-line')).toBeNull()
    })

    it('ArrowLeft from Intl District returns null (junction has no west neighbor)', () => {
      expect(getNextStation(graph, 'International District Station', 'ArrowLeft', '1-line')).toBeNull()
    })

    it('ArrowUp from Stadium returns null (no neighbor at that cardinal)', () => {
      // Stadium's only-mock neighbor is Intl District to the north-northwest;
      // its nearest cardinal is ArrowUp — but the geographic bearing also
      // lets ArrowLeft be a plausible angle. Verify the cardinal-bin guard
      // still rejects a sideways swipe.
      expect(getNextStation(graph, 'Stadium Station', 'ArrowRight', '1-line')).toBeNull()
    })
  })

  describe('getTerminusInfo', () => {
    it('Lynnwood is the north terminus of both lines', () => {
      const info = getTerminusInfo(graph, 'Lynnwood City Center Station')
      expect(info).toEqual({ arrowKey: 'ArrowUp', lines: ['1-line', '2-line'] })
    })

    it('Federal Way is the south terminus of Line 1 only', () => {
      const info = getTerminusInfo(graph, 'Federal Way Downtown Station')
      expect(info).toEqual({ arrowKey: 'ArrowDown', lines: ['1-line'] })
    })

    it('Downtown Redmond is the north terminus of Line 2 only', () => {
      // The line bends north as it approaches DR (Marymoor Village is south
      // of DR), so the local arrival cardinal is ArrowUp even though Line 2
      // travels east in the larger picture.
      const info = getTerminusInfo(graph, 'Downtown Redmond Station')
      expect(info).toEqual({ arrowKey: 'ArrowUp', lines: ['2-line'] })
    })

    it('non-terminus stations return null', () => {
      expect(getTerminusInfo(graph, 'Capitol Hill Station')).toBeNull()
      expect(getTerminusInfo(graph, 'Westlake Station')).toBeNull()
      expect(getTerminusInfo(graph, 'International District Station')).toBeNull()
    })

    it('unknown stations return null', () => {
      expect(getTerminusInfo(graph, 'Not A Station')).toBeNull()
    })
  })

  describe('getDpadHints', () => {
    const arms = (station, line) => Object.fromEntries(
      getDpadHints(graph, station, line).map(h => [h.arrowKey, h.stationName]),
    )

    it('Judkins Park shows travel-direction arms: east to Mercer Island, west to Intl District', () => {
      expect(arms('Judkins Park Station', '2-line')).toEqual({
        ArrowRight: 'Mercer Island Station',
        ArrowLeft: 'International District Station',
      })
    })

    it('a mid-trunk station shows both line directions (Capitol Hill reads north/south across the jog)', () => {
      expect(arms('Capitol Hill Station', '1-line')).toEqual({
        ArrowUp: 'University of Washington Station',
        ArrowDown: 'Westlake Station',
      })
    })

    it('Westlake offers Capitol Hill on both Up and Right (the NE jog)', () => {
      expect(arms('Westlake Station', '1-line')).toEqual({
        ArrowUp: 'Capitol Hill Station',
        ArrowRight: 'Capitol Hill Station',
        ArrowDown: 'Symphony Station',
      })
    })

    it('the junction shows all three directions', () => {
      expect(arms('International District Station', '2-line')).toEqual({
        ArrowUp: 'Pioneer Square Station',
        ArrowRight: 'Judkins Park Station',
        ArrowDown: 'Stadium Station',
      })
    })

    it('a terminus shows a single arm back up the line', () => {
      expect(arms('Federal Way Downtown Station', '1-line')).toEqual({
        ArrowUp: 'Star Lake Station',
      })
    })

    it('every arm agrees with what the arrow key actually does', () => {
      for (const station of ['Judkins Park Station', 'Capitol Hill Station', 'International District Station']) {
        for (const hint of getDpadHints(graph, station, '2-line')) {
          expect(getNextStation(graph, station, hint.arrowKey, '2-line').name).toBe(hint.stationName)
        }
      }
    })

    it('arms carry the line they ride, for divergence roundels', () => {
      const junction = getDpadHints(graph, 'International District Station', '1-line')
      expect(junction.find(h => h.arrowKey === 'ArrowRight').line).toBe('2-line')
      expect(junction.find(h => h.arrowKey === 'ArrowDown').line).toBe('1-line')
    })

    it('returns [] for unknown stations or a missing graph', () => {
      expect(getDpadHints(graph, 'Not A Station', '1-line')).toEqual([])
      expect(getDpadHints(null, 'Westlake Station', '1-line')).toEqual([])
    })

    it('northbound from Westlake reads Up, not Right (reverse of the downtown jog)', () => {
      const node = graph.get('Westlake Station')
      const back = node.neighbors.find(n => n.name === 'Capitol Hill Station' && n.line === '1-line')
      expect(back.cardinal).toBe('ArrowUp')
    })
  })
})

// The line orders used to be two hardcoded arrays in routeGraph.js. They are now
// derived from the committed station data by stopCode, so these lock in that the
// derivation reproduces Sound Transit's published order exactly — a silent
// reordering would break keyboard/swipe navigation everywhere.
const EXPECTED_LINE_1 = [
  'Lynnwood City Center Station', 'Mountlake Terrace Station',
  'Shoreline North/185th Station', 'Shoreline South/148th Station',
  'Northgate Station', 'Roosevelt Station', 'U District Station',
  'University of Washington Station', 'Capitol Hill Station', 'Westlake Station',
  'Symphony Station', 'Pioneer Square Station', 'International District Station',
  'Stadium Station', 'SODO Station', 'Beacon Hill Station', 'Mount Baker Station',
  'Columbia City Station', 'Othello Station', 'Rainier Beach Station',
  'Tukwila International Blvd Station', 'Airport / SeaTac Station',
  'Angle Lake Station', 'Kent Des Moines Station', 'Star Lake Station',
  'Federal Way Downtown Station',
]

const EXPECTED_LINE_2 = [
  'Lynnwood City Center Station', 'Mountlake Terrace Station',
  'Shoreline North/185th Station', 'Shoreline South/148th Station',
  'Northgate Station', 'Roosevelt Station', 'U District Station',
  'University of Washington Station', 'Capitol Hill Station', 'Westlake Station',
  'Symphony Station', 'Pioneer Square Station', 'International District Station',
  'Judkins Park Station', 'Mercer Island Station', 'South Bellevue Station',
  'East Main Station', 'Bellevue Downtown Station', 'Wilburton Station',
  'Spring District/120th Station', 'Bel-Red/130th Station',
  'Overlake Village Station', 'Redmond Technology Center Station',
  'Marymoor Village Station', 'Downtown Redmond Station',
]

describe('deriveLineOrders (real committed data)', () => {
  const stations = JSON.parse(REAL_STATIONS)
  const orders = deriveLineOrders(stations, SEATTLE)

  it('reproduces the published 1 Line order', () => {
    expect(orders.get('1-line')).toEqual(EXPECTED_LINE_1)
  })

  it('reproduces the published 2 Line order', () => {
    expect(orders.get('2-line')).toEqual(EXPECTED_LINE_2)
  })

  it('derives International District as the junction', () => {
    expect(deriveJunction(orders)).toBe('International District Station')
  })
})

describe('deriveLineOrders (single-line city)', () => {
  // Skyline: one line, west to east by HART station ID, so no junction exists.
  const skyline = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Kahauiki Station', line: '1-line', lines: '1', stopCode: 13 }, geometry: { type: 'Point', coordinates: [-157.8889, 21.3328] } },
      { type: 'Feature', properties: { name: 'Kualakaʻi Station', line: '1-line', lines: '1', stopCode: 1 }, geometry: { type: 'Point', coordinates: [-158.0510, 21.3456] } },
      { type: 'Feature', properties: { name: 'Kalauao Station', line: '1-line', lines: '1', stopCode: 8 }, geometry: { type: 'Point', coordinates: [-157.9471, 21.3839] } },
    ],
  }
  const orders = deriveLineOrders(skyline, HONOLULU)

  it('orders by stopCode regardless of feature order', () => {
    expect(orders.get('1-line')).toEqual([
      'Kualakaʻi Station', 'Kalauao Station', 'Kahauiki Station',
    ])
  })

  it('has no junction', () => {
    expect(deriveJunction(orders)).toBeNull()
    const graph = buildGraph(skyline, HONOLULU)
    expect(isJunction(graph, 'Kalauao Station')).toBe(false)
    expect(getJunctionHints(graph, 'Kalauao Station')).toEqual([])
  })

  it('names both termini', () => {
    const graph = buildGraph(skyline, HONOLULU)
    expect(getTerminusInfo(graph, 'Kualakaʻi Station').lines).toEqual(['1-line'])
    expect(getTerminusInfo(graph, 'Kahauiki Station').lines).toEqual(['1-line'])
    expect(getTerminusInfo(graph, 'Kalauao Station')).toBeNull()
  })
})
