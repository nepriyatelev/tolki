import { describe, expect, it } from 'vitest'
import { SCREEN_ENCODING, screenEncodings } from './screen'

describe('screen encodings (PLAN #27)', () => {
  it('sharp text: detail, 15 fps; smooth: motion, up to 60 fps; auto in between', () => {
    expect(SCREEN_ENCODING.text).toMatchObject({ contentHint: 'detail', frameRate: 15 })
    expect(SCREEN_ENCODING.motion).toMatchObject({ contentHint: 'motion', frameRate: 60 })
    expect(SCREEN_ENCODING.auto).toMatchObject({ contentHint: '', frameRate: 30 })
  })

  it('makes a ≈360p and a ≈1080p layer from a 1080p screen', () => {
    expect(screenEncodings('motion', 1080)).toEqual([
      { rid: 'low', scaleResolutionDownBy: 3, maxBitrate: 500_000, maxFramerate: 15 },
      { rid: 'high', scaleResolutionDownBy: 1, maxBitrate: 2_800_000, maxFramerate: 60 },
    ])
  })

  it('scales a bigger screen down to 1080p and never scales a small one up', () => {
    const [low, high] = screenEncodings('text', 1440)
    expect(high?.scaleResolutionDownBy).toBeCloseTo(1440 / 1080)
    expect(low?.scaleResolutionDownBy).toBe(4)
    expect(screenEncodings('auto', 300).map((e) => e.scaleResolutionDownBy)).toEqual([1, 1])
  })

  it('keeps the small layer at 15 fps at most', () => {
    expect(screenEncodings('text', 1080)[0]?.maxFramerate).toBe(15)
    expect(screenEncodings('auto', 1080)[0]?.maxFramerate).toBe(15)
  })
})
