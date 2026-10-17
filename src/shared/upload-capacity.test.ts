import { describe, expect, it } from 'vitest'
import { estimateCapacity } from './upload-capacity'

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
