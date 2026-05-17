import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNavigation } from '../useNavigation'

function makeGraph() {
  const graph = new Map()
  graph.set('Station A', { coords: [-122.3, 47.6], neighbors: [{ name: 'Station B', line: '1-line', coords: [-122.3, 47.65] }] })
  graph.set('Station B', { coords: [-122.3, 47.65], neighbors: [{ name: 'Station A', line: '1-line', coords: [-122.3, 47.6] }, { name: 'Station C', line: '1-line', coords: [-122.3, 47.7] }] })
  graph.set('Station C', { coords: [-122.3, 47.7], neighbors: [{ name: 'Station B', line: '1-line', coords: [-122.3, 47.65] }] })
  return graph
}

describe('useNavigation wheel handler', () => {
  let selectStation
  let graphRef
  let selectedStationRef

  beforeEach(() => {
    selectStation = vi.fn()
    graphRef = { current: makeGraph() }
    selectedStationRef = { current: { name: 'Station B', lng: -122.3, lat: 47.65 } }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not navigate on vertical scroll (zoom gesture)', () => {
    renderHook(() => useNavigation({
      graphRef,
      selectedStationRef,
      currentLine: '1-line',
      selectStation,
    }))

    // Simulate vertical scroll (user zooming the map)
    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: 150,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wheelEvent)

    expect(selectStation).not.toHaveBeenCalled()
  })

  it('does not navigate on vertical scroll up (zoom gesture)', () => {
    renderHook(() => useNavigation({
      graphRef,
      selectedStationRef,
      currentLine: '1-line',
      selectStation,
    }))

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: -150,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wheelEvent)

    expect(selectStation).not.toHaveBeenCalled()
  })

  it('still allows keyboard arrow navigation', () => {
    renderHook(() => useNavigation({
      graphRef,
      selectedStationRef,
      currentLine: '1-line',
      selectStation,
    }))

    // ArrowUp should navigate to next station northward
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(keyEvent)

    expect(selectStation).toHaveBeenCalled()
  })

  it('does not navigate when no station is selected', () => {
    selectedStationRef.current = null
    renderHook(() => useNavigation({
      graphRef,
      selectedStationRef,
      currentLine: '1-line',
      selectStation,
    }))

    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 150,
      deltaY: 0,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wheelEvent)

    expect(selectStation).not.toHaveBeenCalled()
  })
})
