import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScreenLayer } from '@shared/signaling'
import {
  DOWNGRADE_AFTER_MS,
  HIGH_LAYER_MIN_BPS,
  RETRY_HIGH_AFTER_MS,
  ScreenLayerChoice,
} from './screen-layer'

const both = new Set<ScreenLayer>([0, 1])

afterEach(() => {
  vi.useRealTimers()
})

describe('ScreenLayerChoice (#34)', () => {
  it('sends ≈1080p unless the viewer shows it small', () => {
    const onChange = vi.fn()
    const choice = new ScreenLayerChoice(onChange)
    expect(choice.pick(both)).toBe(1)
    choice.prefer(0)
    choice.prefer(0)
    expect(choice.pick(both)).toBe(0)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('sends whichever stream there is when the wanted one is missing', () => {
    const choice = new ScreenLayerChoice(() => undefined)
    expect(choice.pick(new Set([0]))).toBe(0)
    choice.prefer(0)
    expect(choice.pick(new Set([1]))).toBe(1)
    expect(choice.pick(new Set())).toBeNull()
  })

  it('goes down to ≈360p when the network stays too slow, and tries ≈1080p again later', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const choice = new ScreenLayerChoice(onChange, () => Date.now())
    const slow = HIGH_LAYER_MIN_BPS - 1

    // A short dip changes nothing.
    choice.estimate(slow)
    vi.advanceTimersByTime(DOWNGRADE_AFTER_MS - 1)
    choice.estimate(HIGH_LAYER_MIN_BPS)
    vi.advanceTimersByTime(DOWNGRADE_AFTER_MS)
    choice.estimate(slow)
    expect(choice.pick(both)).toBe(1)

    // Slow for long enough: ≈360p.
    vi.advanceTimersByTime(DOWNGRADE_AFTER_MS)
    choice.estimate(slow)
    expect(choice.pick(both)).toBe(0)
    expect(onChange).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(RETRY_HIGH_AFTER_MS)
    expect(choice.pick(both)).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(2)
    choice.close()
  })

  it('stops the retry when closed', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const choice = new ScreenLayerChoice(onChange, () => Date.now())
    choice.estimate(0)
    vi.advanceTimersByTime(DOWNGRADE_AFTER_MS)
    choice.estimate(0)
    choice.close()
    vi.advanceTimersByTime(RETRY_HIGH_AFTER_MS)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
