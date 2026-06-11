import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCompassRotation } from '../useCompass'

// jsdom has no DeviceOrientationEvent; install a stub per test so the
// hook's capability check passes, with an optional iOS-style
// requestPermission gate to exercise the start/stop race.
function installDeviceOrientation({ requestPermission } = {}) {
  const ctor = function () {}
  if (requestPermission) ctor.requestPermission = requestPermission
  window.DeviceOrientationEvent = ctor
}

function fireOrientation(alpha) {
  const event = new Event('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation')
  event.absolute = true
  event.alpha = alpha
  window.dispatchEvent(event)
}

describe('useCompassRotation', () => {
  let map

  beforeEach(() => {
    map = { setBearing: vi.fn(), easeTo: vi.fn() }
  })

  afterEach(() => {
    delete window.DeviceOrientationEvent
  })

  it('rotates the map from orientation events after start()', async () => {
    installDeviceOrientation()
    const { result } = renderHook(() => useCompassRotation(() => map))
    await act(() => result.current.start())
    fireOrientation(270) // alpha 270 -> compass heading 90
    expect(map.setBearing).toHaveBeenCalledWith(90)
  })

  it('stop() removes the listener and eases back to north', async () => {
    installDeviceOrientation()
    const { result } = renderHook(() => useCompassRotation(() => map))
    await act(() => result.current.start())
    fireOrientation(270)
    act(() => result.current.stop())
    expect(map.easeTo).toHaveBeenCalledWith({ bearing: 0, duration: 400 })
    map.setBearing.mockClear()
    fireOrientation(180)
    expect(map.setBearing).not.toHaveBeenCalled()
  })

  it('a defensive stop() when rotation never ran does not touch the camera', () => {
    installDeviceOrientation()
    const { result } = renderHook(() => useCompassRotation(() => map))
    act(() => result.current.stop())
    act(() => result.current.stop())
    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('a stop() during the permission prompt cancels the pending start (the orphaned-listener race)', async () => {
    let grant
    installDeviceOrientation({
      requestPermission: () => new Promise(resolve => { grant = resolve }),
    })
    const { result } = renderHook(() => useCompassRotation(() => map))
    let started
    act(() => { started = result.current.start() })
    // The session ends (e.g. a trackuserlocationend) while the user is
    // still looking at the iOS permission dialog...
    act(() => result.current.stop())
    // ...then permission is granted. The cancelled start must not attach.
    await act(async () => { grant('granted'); await started })
    fireOrientation(270)
    expect(map.setBearing).not.toHaveBeenCalled()
  })

  it('a fresh start() after a cancelling stop() still works', async () => {
    installDeviceOrientation({ requestPermission: () => Promise.resolve('granted') })
    const { result } = renderHook(() => useCompassRotation(() => map))
    await act(() => result.current.start())
    act(() => result.current.stop())
    await act(() => result.current.start())
    fireOrientation(180) // heading 180
    expect(map.setBearing).toHaveBeenCalledWith(180)
  })

  it('denied permission degrades silently', async () => {
    installDeviceOrientation({ requestPermission: () => Promise.resolve('denied') })
    const { result } = renderHook(() => useCompassRotation(() => map))
    await act(() => result.current.start())
    fireOrientation(270)
    expect(map.setBearing).not.toHaveBeenCalled()
  })

  it('ignores jitter under the minimum heading delta', async () => {
    installDeviceOrientation()
    const { result } = renderHook(() => useCompassRotation(() => map))
    await act(() => result.current.start())
    fireOrientation(270)
    fireOrientation(269) // 1 degree of jitter
    expect(map.setBearing).toHaveBeenCalledTimes(1)
    fireOrientation(265) // 5 degrees: a real turn
    expect(map.setBearing).toHaveBeenCalledTimes(2)
  })
})
