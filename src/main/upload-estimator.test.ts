import { describe, expect, it, vi } from 'vitest'
import { UploadEstimator } from './upload-estimator'

function setup(options: { enabled?: boolean; fail?: boolean } = {}) {
  let now = 1_000
  let enabled = options.enabled ?? true
  const measure = vi.fn(() =>
    options.fail ? Promise.reject(new Error('offline')) : Promise.resolve({ mbps: 92 }),
  )
  const estimator = new UploadEstimator({
    isEnabled: () => enabled,
    measure,
    cacheMs: 60_000,
    now: () => now,
  })
  return {
    estimator,
    measure,
    advance: (ms: number) => {
      now += ms
    },
    setEnabled: (value: boolean) => {
      enabled = value
    },
  }
}

describe('UploadEstimator', () => {
  it('measures and reports Mbit/s with a timestamp', async () => {
    const { estimator } = setup()

    await expect(estimator.measure()).resolves.toEqual({
      status: 'measured',
      mbps: 92,
      measuredAt: 1_000,
    })
  })

  it('does not contact the speed test when disabled', async () => {
    const { estimator, measure } = setup({ enabled: false })

    await expect(estimator.measure({ force: true })).resolves.toEqual({ status: 'disabled' })
    expect(measure).not.toHaveBeenCalled()
  })

  it('respects the setting being turned off later', async () => {
    const { estimator, setEnabled } = setup()
    await estimator.measure()

    setEnabled(false)

    await expect(estimator.measure()).resolves.toEqual({ status: 'disabled' })
  })

  it('turns errors into a failed status instead of throwing', async () => {
    const { estimator } = setup({ fail: true })

    await expect(estimator.measure()).resolves.toEqual({ status: 'failed', detail: 'offline' })
  })

  it('shares a running test and caches the result', async () => {
    const { estimator, measure, advance } = setup()

    await Promise.all([estimator.measure(), estimator.measure()])
    advance(30_000)
    await estimator.measure()
    expect(measure).toHaveBeenCalledTimes(1)

    await estimator.measure({ force: true })
    advance(61_000)
    await estimator.measure()
    expect(measure).toHaveBeenCalledTimes(3)
  })
})
