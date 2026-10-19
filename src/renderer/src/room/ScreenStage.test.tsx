import { fireEvent, render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenSample } from './call'
import {
  CHROME_HIDE_MS,
  HIGH_LAYER_MIN_HEIGHT,
  layerForHeight,
  ScreenStage,
  STATS_INTERVAL_MS,
} from './ScreenStage'

describe('layerForHeight', () => {
  it('picks ≈1080p only when the screen is shown big enough to tell', () => {
    expect(layerForHeight(300, 1)).toBe(0)
    expect(layerForHeight(HIGH_LAYER_MIN_HEIGHT, 1)).toBe(1)
    // A HiDPI display shows more pixels in the same CSS size.
    expect(layerForHeight(300, 2)).toBe(1)
  })
})

describe('ScreenStage', () => {
  let hidden = false
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
  })
  afterEach(() => {
    hidden = false
    vi.useRealTimers()
  })

  function show(sample: () => Promise<ScreenSample | null> = () => Promise.resolve(null)) {
    const onVisibleChange = vi.fn<(consumerId: string, visible: boolean) => void>()
    const view = render(() => (
      <ScreenStage
        title="Экран: Дима"
        name="Дима"
        stream={{} as MediaStream}
        consumerId="c1"
        sample={sample}
        onVisibleChange={onVisibleChange}
      />
    ))
    return { onVisibleChange, view }
  }

  it('shows who shares, and pauses while the window is hidden or the stage closes', () => {
    const { onVisibleChange, view } = show()
    expect(screen.getByRole('region', { name: 'Экран: Дима' })).toBeTruthy()
    expect(onVisibleChange).toHaveBeenLastCalledWith('c1', true)

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onVisibleChange).toHaveBeenLastCalledWith('c1', false)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onVisibleChange).toHaveBeenLastCalledWith('c1', true)

    view.unmount()
    expect(onVisibleChange).toHaveBeenLastCalledWith('c1', false)
  })

  it('shows «1080p · 30 к/с · 2,8 Мбит/с» from the stats', async () => {
    vi.useFakeTimers()
    let bytes = 0
    show(() => {
      bytes += 350_000
      return Promise.resolve({ height: 1080, fps: 30, bytes, timestamp: bytes / 350 })
    })

    await vi.advanceTimersByTimeAsync(STATS_INTERVAL_MS * 2)

    expect(screen.getByText('1080p · 30 к/с · 2,8 Мбит/с')).toBeTruthy()
  })

  it('goes full screen on request', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.assign(HTMLElement.prototype, { requestFullscreen })
    show()

    await userEvent.setup().click(screen.getByRole('button', { name: 'На весь экран' }))

    expect(requestFullscreen).toHaveBeenCalledOnce()
  })

  it('goes full screen on a double click on the picture', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.assign(HTMLElement.prototype, { requestFullscreen })
    const { view } = show()

    const video = view.container.querySelector('video')
    if (!video) throw new Error('no video')
    fireEvent.dblClick(video)

    expect(requestFullscreen).toHaveBeenCalledOnce()
  })

  it('hides the chips and the cursor when the mouse rests, and shows them on a move', () => {
    vi.useFakeTimers()
    show()
    const stage = screen.getByRole('region', { name: 'Экран: Дима' })
    expect(stage.classList.contains('screen-stage--idle')).toBe(false)

    vi.advanceTimersByTime(CHROME_HIDE_MS)
    expect(stage.classList.contains('screen-stage--idle')).toBe(true)

    fireEvent.pointerMove(stage)
    expect(stage.classList.contains('screen-stage--idle')).toBe(false)
    vi.advanceTimersByTime(CHROME_HIDE_MS - 1)
    expect(stage.classList.contains('screen-stage--idle')).toBe(false)
  })
})
