import { describe, expect, it } from 'vitest'
import { SCREEN_ENCODING, screenStreams, systemAudioSupported } from './screen'

describe('screen encodings (PLAN #27, #34)', () => {
  it('sharp text: detail, 15 fps; smooth: motion, up to 60 fps; auto in between', () => {
    expect(SCREEN_ENCODING.text).toMatchObject({ contentHint: 'detail', frameRate: 15 })
    expect(SCREEN_ENCODING.motion).toMatchObject({ contentHint: 'motion', frameRate: 60 })
    expect(SCREEN_ENCODING.auto).toMatchObject({ contentHint: '', frameRate: 30 })
  })

  it('makes a ≈1080p and a ≈360p stream from a 1080p screen', () => {
    expect(screenStreams('motion', 1080)).toEqual({
      high: { scaleResolutionDownBy: 1, maxBitrate: 2_800_000, maxFramerate: 60 },
      low: { scaleResolutionDownBy: 3, maxBitrate: 500_000, maxFramerate: 15 },
    })
  })

  it('scales a bigger screen down to 1080p and never scales a small one up', () => {
    const { high, low } = screenStreams('text', 1440)
    expect(high.scaleResolutionDownBy).toBeCloseTo(1440 / 1080)
    expect(low.scaleResolutionDownBy).toBe(4)
    const small = screenStreams('auto', 300)
    expect([small.high.scaleResolutionDownBy, small.low.scaleResolutionDownBy]).toEqual([1, 1])
  })

  it('keeps the small stream at 15 fps at most', () => {
    expect(screenStreams('text', 1080).low.maxFramerate).toBe(15)
    expect(screenStreams('auto', 1080).low.maxFramerate).toBe(15)
  })
})

describe('the computer’s sound with the screen (#41)', () => {
  it('is offered on Windows and on macOS from 14.2, not on Linux yet', () => {
    expect(systemAudioSupported('win32', '10.0.22631')).toBe(true)
    expect(systemAudioSupported('darwin', '23.2.0')).toBe(true)
    expect(systemAudioSupported('darwin', '25.6.0')).toBe(true)
    expect(systemAudioSupported('darwin', '23.1.0')).toBe(false)
    expect(systemAudioSupported('darwin', '22.6.0')).toBe(false)
    expect(systemAudioSupported('linux', '6.8.0')).toBe(false)
  })
})
