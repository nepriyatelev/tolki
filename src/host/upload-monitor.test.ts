import { describe, expect, it } from 'vitest'
import { uploadFromStats } from './upload-monitor'

describe('uploadFromStats', () => {
  it('is null while nothing is sent', () => {
    expect(uploadFromStats([])).toBeNull()
    expect(uploadFromStats([{ sendBitrate: 0 }])).toBeNull()
  })

  it('counts everything sent at once', () => {
    expect(uploadFromStats([{ sendBitrate: 1_500_000 }, { sendBitrate: 500_000 }])).toBe(2)
  })

  it('uses the best path estimate when it says more than what is sent', () => {
    expect(
      uploadFromStats([
        { sendBitrate: 100_000, availableOutgoingBitrate: 8_000_000 },
        { sendBitrate: 100_000, availableOutgoingBitrate: 3_000_000 },
      ]),
    ).toBe(8)
  })
})
