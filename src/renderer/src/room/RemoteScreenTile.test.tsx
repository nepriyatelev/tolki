import { render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteScreen } from './call'
import { HIGH_LAYER_MIN_HEIGHT, layerForHeight, RemoteScreenTile } from './RemoteScreenTile'

describe('layerForHeight', () => {
  it('picks ≈1080p only when the screen is shown big enough to tell', () => {
    expect(layerForHeight(300, 1)).toBe(0)
    expect(layerForHeight(HIGH_LAYER_MIN_HEIGHT, 1)).toBe(1)
    // A HiDPI display shows more pixels in the same CSS size.
    expect(layerForHeight(300, 2)).toBe(1)
  })
})

describe('RemoteScreenTile', () => {
  let hidden = false
  beforeEach(() => {
    vi.stubGlobal('MediaStream', vi.fn())
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    hidden = false
  })

  it('pauses while the window is hidden and resumes when it is back', () => {
    const onVisibleChange = vi.fn()
    const remote = { consumerId: 'c1', peerId: 'dima', track: {} } as unknown as RemoteScreen
    render(() => (
      <RemoteScreenTile
        screen={remote}
        name="Дима"
        onVisibleChange={onVisibleChange}
        onLayerChange={() => undefined}
      />
    ))
    expect(screen.getByRole('listitem', { name: 'Экран: Дима' })).toBeTruthy()

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onVisibleChange).toHaveBeenLastCalledWith(false)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onVisibleChange).toHaveBeenLastCalledWith(true)
  })
})
