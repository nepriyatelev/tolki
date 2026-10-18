import { describe, expect, it } from 'vitest'
import { callLogLine } from './call-log'

const link = (packetsReceived: number, packetsLost: number) => ({
  rttMs: 24,
  protocol: 'udp' as const,
  packetsReceived,
  packetsLost,
})

describe('callLogLine (#106)', () => {
  it('writes the round trip, the path and the loss since the last line', () => {
    expect(callLogLine({ now: link(1980, 20), before: link(990, 10) }, null)).toBe(
      '[call] link 24 ms over UDP, loss 1.0 %',
    )
  })

  it('adds the screen with its bitrate and encoder', () => {
    expect(
      callLogLine(
        { now: link(10, 0), before: null },
        {
          own: true,
          before: { height: 1080, fps: 60, bytes: 0, timestamp: 0 },
          now: {
            height: 1080,
            fps: 60,
            bytes: 10_500_000,
            timestamp: 30_000,
            encoder: 'VideoToolbox',
          },
        },
      ),
    ).toBe(
      '[call] link 24 ms over UDP, loss 0.0 %; sending screen 1080p 60 fps 2.8 Mbit/s, encoder VideoToolbox',
    )
  })

  it('says so before the link has numbers', () => {
    expect(callLogLine({ now: null, before: null }, null)).toBe('[call] link: no numbers yet')
  })
})
