import { describe, expect, it } from 'vitest'
import { estimateCapacity, screenBudget } from './upload-capacity'

describe('estimateCapacity', () => {
  it.each([
    // The mockup's example: 92 Mbit/s serves a full room with a 1080p screen.
    [92, 15, '1080p'],
    // A full room at 1080p needs 14 × (0.15 + 2.8) Mbit/s / 0.75 ≈ 55 Mbit/s.
    [56, 15, '1080p'],
    [54, 15, '720p'],
    [35, 15, '720p'],
    [30, 15, '360p'],
    [20, 15, '360p'],
    // Voice for 15 people needs 14 × 0.15 / 0.75 = 2.8 Mbit/s.
    [2.8, 15, null],
    [1, 6, null],
    [0.1, 1, null],
    [0, 1, null],
  ] as const)('%s Mbit/s → %s people, screen %s', (mbps, participants, screen) => {
    expect(estimateCapacity(mbps)).toEqual({ uploadMbps: mbps, participants, screen })
  })

  it('treats negative input as no upload', () => {
    expect(estimateCapacity(-5)).toMatchObject({ participants: 1, screen: null })
  })
})

describe('screenBudget (#86)', () => {
  it('fits the big screen stream into the upload for everyone watching', () => {
    // 40 Mbit/s: 14 viewers × (0.15 + 1.5) ≤ 30 usable, 1080p (2.8) does not fit.
    expect(screenBudget(40, 14)).toEqual({ height: 720, maxBitrate: 1_500_000 })
    expect(screenBudget(40, 3)).toEqual({ height: 1080, maxBitrate: 2_800_000 })
  })

  it('goes down as people come and up as they leave', () => {
    expect(screenBudget(10, 2)?.height).toBe(1080)
    expect(screenBudget(10, 4)?.height).toBe(720)
    expect(screenBudget(10, 10)?.height).toBe(360)
  })

  it('keeps 360p when even that does not fit; no ceiling without viewers', () => {
    expect(screenBudget(0.5, 4)).toEqual({ height: 360, maxBitrate: 500_000 })
    expect(screenBudget(10, 0)).toBeNull()
  })
})
